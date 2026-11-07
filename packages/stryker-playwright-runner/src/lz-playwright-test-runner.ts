import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout } from 'node:timers/promises';

import { INSTRUMENTER_CONSTANTS, type Mutant } from '@stryker-mutator/api/core';
import type { Logger } from '@stryker-mutator/api/logging';
import { commonTokens, tokens } from '@stryker-mutator/api/plugin';
import type {
  DryRunOptions,
  DryRunResult,
  ErrorMutantRunResult,
  MutantRunOptions,
  MutantRunResult,
  TestRunner as StrykerTestRunner,
} from '@stryker-mutator/api/test-runner';
import { MutantRunStatus } from '@stryker-mutator/api/test-runner';

import {
  readRunnerOptions,
  type RunnerOptions,
  type LzPlaywrightRunnerOptionsWithStrykerOptions,
} from './lz-playwright-runner-options-with-stryker-options.ts';
import {
  type ConfigHandles,
  type ConfigWebServer,
  isSerialSuite,
  loadPlaywright,
  noCopyPromptEnv,
  type Playwright,
  type TestRunner,
} from './playwright-internals.ts';
import { globalSetupWatchingConfiguredPorts } from './port-watch.ts';
import { withEnv } from './process-env.ts';
import { readSnapshotDir } from './protocol.ts';
import {
  LzPlaywrightCollectingReporter,
  type ReportedTest,
} from './reporter.ts';
import {
  dryRunRequest,
  mutantRunRequest,
  runPlan,
  type RunRequest,
} from './run-request.ts';
import {
  type CoverageGaps,
  dryRunResult,
  flakyTestNames,
  mayHaveLostItsServer,
  mutantRunResult,
  type RunOutput,
} from './run-result.ts';
import {
  listTests,
  projectsPlaywrightRuns,
  projectsThatRun,
  type SerialGroups,
  serialGroups,
} from './serial-groups.ts';
import {
  type ServerCheck,
  serverCheck,
  serverTarget,
} from './server-checks.ts';
import {
  moveApart,
  moveServersApart,
  startsMoreRunners,
} from './server-ports.ts';
import {
  anyHooked,
  forgetHooked,
  hostKey,
  serverDirEnv,
  writeServerControl,
} from './server-protocol.ts';
import {
  mutateOption,
  type ServerMutate,
  ServerSupportRefused,
} from './server-refusal.ts';
import {
  readServerMutantsFile,
  restartsToIsolate,
  type RunKind,
  runKind,
  startupMutantFor,
  type ServerMutants,
  type ServerMutantsFile,
  writeServerMutantsFile,
} from './server-isolation.ts';
import {
  copySurvivorTraces,
  readTracesTarget,
  type TracesTarget,
} from './survivor-traces.ts';
import { claimTempRoot, removeDir, type TempRoot } from './temp-root.ts';
import {
  armDeadline,
  assertionTimeoutWarning,
  configRetries,
  type ConfigTimeouts,
  configTimeouts,
} from './timeouts.ts';

/** The webServer side of a session, when server support is on. */
interface ServerSide {
  readonly mutate: ServerMutate;
  /** Holds the control file and the hooked marks of the processes global setup starts. */
  readonly dir: string;
  readonly testIdHosts: readonly string[];
}

interface Session {
  readonly options: RunnerOptions;
  readonly playwright: TestRunner;
  readonly root: TempRoot;
  readonly servers: readonly ServerCheck[];
  readonly server: ServerSide | undefined;
  readonly serialGroups: SerialGroups;
  readonly listedTestIds: readonly string[];
  readonly timeouts: ConfigTimeouts;
  readonly retriesByProject: ReadonlyMap<string, number>;
  readonly traces: TracesTarget | undefined;
}

const hookUrl = (name: string) =>
  new URL(`./${name}${path.extname(import.meta.filename)}`, import.meta.url)
    .href;
const workerHookUrl = hookUrl('worker-hook');
const serverHookUrl = hookUrl('server-hook');
const hookedWaitMs = 1000;

class StaticMutantStopsServer extends Error {
  constructor(mutant: string, cause: unknown) {
    super(
      `The webServer did not start with static mutant ${mutant}: ${String(cause)}`,
      { cause },
    );
  }
}

const runOverrides = ({
  traced,
  screenshots,
}: {
  traced: boolean;
  screenshots: boolean;
}) => ({
  use: {
    screenshot: 'off',
    trace: traced ? { mode: 'on', screenshots, snapshots: true } : 'off',
    video: 'off',
  },
});

export class LzPlaywrightTestRunner implements StrykerTestRunner {
  static inject = tokens(commonTokens.options, commonTokens.logger);

  readonly #strykerOptions: LzPlaywrightRunnerOptionsWithStrykerOptions;
  readonly #log: Logger;
  readonly #baseNodeOptions = process.env['NODE_OPTIONS'];
  readonly #sandbox = process.cwd();
  #session: Session | undefined;
  /** The static mutant the webServer last started with. */
  #serverMutant: string | undefined;
  #dryRunServerMutants: ServerMutants | undefined;
  #serverMutantsFile: ServerMutantsFile | undefined;
  #previousRun: RunKind = 'other';

  constructor(
    options: LzPlaywrightRunnerOptionsWithStrykerOptions,
    log: Logger,
  ) {
    this.#strykerOptions = options;
    this.#log = log;
  }

  capabilities() {
    return { reloadEnvironment: true };
  }

  async init(): Promise<void> {
    const options = readRunnerOptions(this.#strykerOptions);
    const { mutate } = options.webServer;
    await this.#start(options, mutate || undefined).catch((error: unknown) => {
      if (mutate !== 'auto' || !(error instanceof ServerSupportRefused)) {
        throw error;
      }

      this.#log.warn(
        `${error.message} Server-side mutants stay NoCoverage in this run; ${mutateOption}: true makes this an error instead.`,
      );

      return this.#start(options, undefined);
    });
    const { timeouts, retriesByProject } = this.#ready();
    const warning = assertionTimeoutWarning(
      timeouts,
      options.strykerTimeoutMS,
      Math.max(0, ...retriesByProject.values()),
    );

    if (warning) {
      this.#log.warn(warning);
    }
  }

  async #start(
    options: RunnerOptions,
    mutate: ServerMutate | undefined,
  ): Promise<void> {
    const traces = readTracesTarget(options.survivorTraces, process.env);
    const pw = loadPlaywright(options.configFile);
    const root = claimTempRoot((removed) => {
      if (removed.length) {
        this.#log.debug(
          `Removed the temp directories of runners that no longer run: ${removed.join(', ')}`,
        );
      }
    });
    let playwright: (TestRunner & ConfigHandles) | undefined;
    let undoMove: (() => void) | undefined;

    try {
      const created = await pw.createTestRunner(options.configFile, {
        outputDir: root.outputDir,
        ...runOverrides({
          traced: traces !== undefined,
          screenshots: options.traceScreenshots,
        }),
      });
      playwright = created;
      const config = await playwright.loadConfig();
      const timeouts = configTimeouts(config.projects);
      const retriesByProject = configRetries(config.projects, options.retries);
      const running = projectsThatRun(options.projects, config.projects);
      const apart =
        mutate &&
        startsMoreRunners(this.#strykerOptions, os.availableParallelism())
          ? await moveServersApart(
              {
                ...config,
                projects: projectsPlaywrightRuns(running, config.projects),
              },
              process.env,
              mutate,
            )
          : undefined;

      if (apart) {
        undoMove = moveApart(playwright, apart);
        this.#log.debug(
          `Stryker starts more than one test runner process, so this one's webServer moves to a port of its own: ${apart.moves.map(({ from, to }) => `${from} -> ${to}`).join(', ')}.`,
        );
      }

      const webServers = apart?.webServers ?? config.webServers;
      const servers = webServers.flatMap(
        (server) => serverCheck(server, pw.isURLAvailable) ?? [],
      );
      const server = mutate
        ? await serverSide(mutate, root, webServers, pw.isURLAvailable)
        : undefined;
      const setup = () => this.#globalSetup(created, server, undefined);
      await (mutate && apart
        ? globalSetupWatchingConfiguredPorts(
            setup,
            {
              moves: apart.moves,
              configuredChecks: config.webServers.map((webServer) =>
                serverCheck(webServer, pw.isURLAvailable),
              ),
            },
            mutate,
          )
        : setup());
      // Every Stryker test runner process needs the groups, and only one of them runs the dry run.
      // Listed after global setup, like Playwright's own CLI, because test files may read what it
      // creates.
      const listed = await listTests(playwright, running);
      this.#session = {
        options,
        playwright,
        root,
        servers,
        server,
        serialGroups: serialGroups(listed, (suite) =>
          isSerialSuite(suite, pw.version),
        ),
        listedTestIds: listed.map((test) => test.id),
        timeouts,
        retriesByProject,
        traces,
      };
    } catch (error) {
      await playwright?.runGlobalTeardown().catch(() => undefined);
      undoMove?.();

      try {
        root.remove();
      } catch {
        // The next runner's removeLeftRoots removes it once this process has exited.
      }

      throw error;
    }
  }

  async dispose(): Promise<void> {
    const session = this.#session;
    this.#session = undefined;

    if (!session) {
      return;
    }

    // Stryker disposes a timed-out runner while its run is still going, and kills it 2 s later, so
    // the run's directories go first. The root stays until the workers are gone.
    session.root.removeRunsAndOutput();
    await session.playwright.stopTests();
    await session.playwright.runGlobalTeardown();
    session.root.remove();
  }

  async dryRun(options: DryRunOptions): Promise<DryRunResult> {
    const session = this.#ready();
    const request = dryRunRequest(options);
    const output = await this.#run(session, request);
    // Stryker gives every mutant run the dry run's time beyond its tests, so the dry run pays for one restart.
    await this.#serveMutant(
      session,
      undefined,
      session.options.webServer.isolate && output.serverMutants.length > 0,
    );
    this.#dryRunServerMutants = new Set(output.serverMutants);

    if (session.options.webServer.mutate) {
      writeServerMutantsFile(this.#sandbox, output.serverMutants);
    }

    const { result, gaps } = dryRunResult(output, request);
    const flaky = flakyTestNames(output);

    if (flaky.length > 0) {
      this.#log.warn(
        `${flaky.length} test(s) passed only on a retry in the dry run: ${flaky.join(', ')}`,
      );
    }

    if (gaps) {
      logCoverageGaps(this.#log, gaps);
    }

    if (
      session.options.webServer.mutate === 'auto' &&
      session.server &&
      output.serverMutants.length === 0
    ) {
      this.#session = { ...session, server: undefined };
      this.#log.info(
        `Server-side mutants stay NoCoverage: with ${mutateOption}: 'auto', the dry run reached no mutant in the code the Playwright webServer runs, so server support stays off.`,
      );
    }

    if (
      session.options.webServer.mutate === false &&
      session.servers.length > 0
    ) {
      this.#log.info(
        `Server-side mutants stay NoCoverage: the code the Playwright webServer runs is mutated only with ${mutateOption}: true.`,
      );
    }

    return result;
  }

  async mutantRun(options: MutantRunOptions): Promise<MutantRunResult> {
    const session = this.#adoptDryRunDecision(this.#ready());

    if ('status' in session) {
      return session;
    }

    const request = mutantRunRequest(options, session);
    let output: RunOutput;

    try {
      output = await this.#run(session, request);
    } catch (error) {
      if (!(error instanceof StaticMutantStopsServer)) {
        throw error;
      }

      return {
        status: MutantRunStatus.Killed,
        killedBy: [],
        failureMessage: error.message,
        nrOfTests: 0,
      };
    }

    const { result, hitCount } = mutantRunResult(output, request);
    this.#log.debug(
      `Mutant ${request.activeMutant}: ${result.status}, hitCount ${hitCount}/${request.hitLimit}`,
    );

    // Playwright deletes a test's output folder when that test runs again, so copy before the next run.
    if (session.traces && result.status === MutantRunStatus.Survived) {
      this.#keepSurvivorTraces(
        session.traces,
        options.activeMutant,
        output.reporter.testCases.values(),
      );
    }

    return result;
  }

  #keepSurvivorTraces(
    target: TracesTarget,
    mutant: Mutant,
    tests: Iterable<ReportedTest>,
  ): void {
    try {
      const dir = copySurvivorTraces(target, mutant, tests);
      this.#log.debug(`Mutant ${mutant.id}: traces in ${dir}`);
    } catch (error) {
      this.#log.warn(
        `Mutant ${mutant.id}: could not copy its traces: ${String(error)}`,
      );
    }
  }

  #adoptDryRunDecision(session: Session): Session | ErrorMutantRunResult {
    if (
      session.options.webServer.mutate !== 'auto' ||
      this.#dryRunServerMutants !== undefined
    ) {
      return session;
    }

    const file = this.#readServerMutantsFile();

    if (!('mutants' in file)) {
      return session;
    }

    if (file.mutants.size > 0 && !session.server) {
      return {
        status: MutantRunStatus.Error,
        errorMessage:
          `${mutateOption} is 'auto' and the dry run reached server-side mutants, but this process turned server ` +
          `support off at init (see its warning), so it cannot run them. Set ${mutateOption}: true to see the ` +
          'cause as an error.',
      };
    }

    this.#dryRunServerMutants = file.mutants;

    if (file.mutants.size > 0) {
      return session;
    }

    this.#session = { ...session, server: undefined };

    return this.#session;
  }

  #ready(): Session {
    if (!this.#session) {
      throw new Error(
        'The Playwright test runner was used before init() finished.',
      );
    }

    return this.#session;
  }

  async #run(session: Session, request: RunRequest): Promise<RunOutput> {
    const deadlineAt =
      request.budget.deadlineMs === undefined
        ? undefined
        : performance.now() + request.budget.deadlineMs;
    const serverMutants = () => this.#serverMutants(session);
    const kind = session.options.webServer.isolate
      ? runKind(request, serverMutants)
      : 'other';
    const isolate = restartsToIsolate(
      session.options.webServer.isolate,
      this.#previousRun,
      kind,
    );
    this.#previousRun = kind;
    const mutant = startupMutantFor(request, serverMutants);
    await this.#serveMutant(session, mutant, isolate).catch(
      (error: unknown) => {
        throw mutant === undefined || error instanceof ServerSupportRefused
          ? error
          : new StaticMutantStopsServer(mutant, error);
      },
    );
    await this.#restartDeadServers(session);
    let output = await this.#runOnce(session, request, deadlineAt);

    if (
      mayHaveLostItsServer(output) &&
      (await this.#restartDeadServers(session))
    ) {
      output = await this.#runOnce(session, request, deadlineAt);
    }

    return output;
  }

  async #runOnce(
    session: Session,
    request: RunRequest,
    deadlineAt: number | undefined,
  ): Promise<RunOutput> {
    const outDir = session.root.nextRunDir();
    const reporter = new LzPlaywrightCollectingReporter(
      session.retriesByProject,
    );
    const deadline = armDeadline(deadlineAt, () =>
      session.playwright.stopTests(),
    );

    try {
      const { env, params, control } = runPlan(
        request,
        outDir,
        session.server?.testIdHosts,
        session.listedTestIds,
      );

      if (session.server) {
        writeServerControl(session.server.dir, control);
      }

      // Only the workers this run forks see these; the webServer started earlier never does.
      const { status } = await withEnv(
        {
          NODE_OPTIONS:
            `--import "${workerHookUrl}" ${this.#baseNodeOptions ?? ''}`.trim(),
          ...env,
          [noCopyPromptEnv]: '1',
        },
        () =>
          session.playwright.runTests(reporter, {
            locations: [],
            projects: session.options.projects,
            workers: session.options.workers,
            disableConfigReporters: true,
            ...params,
          }),
      );
      const { firedAt } = deadline;

      if (firedAt !== undefined) {
        this.#log.debug(
          `deadline stop took ${Math.round(performance.now() - firedAt)} ms`,
        );
      }

      return {
        status:
          firedAt !== undefined && status === 'interrupted'
            ? 'deadline'
            : status,
        reporter,
        ...readSnapshotDir(outDir),
      };
    } finally {
      deadline.disarm();
      removeDir(outDir);
    }
  }

  // Playwright watches a webServer only while it starts. One that dies later would fail every
  // remaining test, and Stryker would count each mutant as killed.
  async #restartDeadServers(session: Session): Promise<boolean> {
    const up = await Promise.all(
      session.servers.map((server) => server.isUp()),
    );
    const dead = session.servers.filter((_, index) => !up[index]);

    if (dead.length === 0) {
      return false;
    }

    const names = dead.map((server) => server.name).join(', ');
    this.#log.warn(
      `webServer at ${names} stopped answering; rerunning Playwright global setup (global teardown runs first).`,
    );
    await this.#globalSetup(
      session.playwright,
      session.server,
      this.#serverMutant,
    );

    return true;
  }

  #serverMutants(session: Session): ServerMutants {
    if (!session.server) {
      return new Set();
    }

    if (this.#dryRunServerMutants === undefined) {
      const file = this.#readServerMutantsFile();

      if ('mutants' in file) {
        this.#dryRunServerMutants = file.mutants;
      } else {
        this.#log.warn(
          `This process did not run the dry run and cannot read the mutants the webServer ran in it (${file.cause}), so it restarts the webServer ${session.options.webServer.isolate ? 'around every mutant run' : 'for every static mutant'}.`,
        );
        this.#dryRunServerMutants = 'unknown';
      }
    }

    return this.#dryRunServerMutants;
  }

  #readServerMutantsFile(): ServerMutantsFile {
    this.#serverMutantsFile ??= readServerMutantsFile(this.#sandbox);

    return this.#serverMutantsFile;
  }

  async #serveMutant(
    session: Session,
    mutant: string | undefined,
    isolate: boolean,
  ) {
    if (!session.server || (!isolate && mutant === this.#serverMutant)) {
      return;
    }

    this.#log.debug(
      `Restarting the webServer ${mutant === undefined ? 'without a mutant' : `with static mutant ${mutant}`}.`,
    );
    await this.#globalSetup(session.playwright, session.server, mutant);
  }

  /** Global teardown runs first, so this also restarts the webServer that global setup started. */
  async #globalSetup(
    playwright: TestRunner,
    server: ServerSide | undefined,
    mutant: string | undefined,
  ) {
    if (!server) {
      await runGlobalSetup(playwright);

      return;
    }

    forgetHooked(server.dir);
    await withEnv(
      {
        NODE_OPTIONS:
          `--import "${serverHookUrl}" ${this.#baseNodeOptions ?? ''}`.trim(),
        [serverDirEnv]: server.dir,
        [INSTRUMENTER_CONSTANTS.ACTIVE_MUTANT_ENV_VARIABLE]: mutant,
      },
      () => runGlobalSetup(playwright),
    );
    this.#serverMutant = mutant;

    if (!(await hookedWithin(server.dir, hookedWaitMs))) {
      throw new ServerSupportRefused(
        server.mutate,
        'no process that Playwright global setup started loaded the server hook. ' +
          'A webServer that is not Node.js, a command that sets NODE_OPTIONS itself, or a server that was already ' +
          'running cannot get the active mutant.',
      );
    }
  }
}

/**
 * Fails on what server support cannot handle: a NODE_OPTIONS in webServer.env replaces the runner's, and
 * a server that answers before global setup with reuseExistingServer belongs to another process, which
 * this runner cannot switch to its mutant.
 */
async function serverSide(
  mutate: ServerMutate,
  root: Pick<TempRoot, 'dir'>,
  webServers: readonly ConfigWebServer[],
  isURLAvailable: Playwright['isURLAvailable'],
): Promise<ServerSide> {
  if (webServers.some((server) => server.setsNodeOptions)) {
    throw new ServerSupportRefused(
      mutate,
      "a webServer's env sets NODE_OPTIONS, which replaces the one that loads " +
        'the server hook. Set NODE_OPTIONS in the environment that runs Stryker instead.',
    );
  }

  const reused = webServers
    .filter((server) => server.reuseExistingServer)
    .flatMap((server) => serverCheck(server, isURLAvailable) ?? []);
  const up = await Promise.all(reused.map((server) => server.isUp()));
  const shared = reused.filter((_, index) => up[index]);

  if (shared.length > 0) {
    throw new ServerSupportRefused(
      mutate,
      `the webServer at ${shared.map((server) => server.name).join(', ')} ` +
        'already answers and reuseExistingServer is true. Only the Stryker process that started a server can ' +
        'switch its mutant: stop the server that answers there, or give the webServer a port that no other server uses.',
    );
  }

  const dir = path.join(root.dir, 'server');
  fs.mkdirSync(dir, { recursive: true });

  return {
    mutate,
    dir,
    testIdHosts: webServers.flatMap((server) => serverHost(server) ?? []),
  };
}

function serverHost(server: ConfigWebServer): string | undefined {
  const target = serverTarget(server);

  if (target === undefined) {
    return undefined;
  }

  return 'port' in target
    ? `localhost:${target.port}`
    : hostKey(new URL(target.url));
}

async function hookedWithin(dir: string, waitMs: number): Promise<boolean> {
  const until = performance.now() + waitMs;

  while (!anyHooked(dir)) {
    if (performance.now() >= until) {
      return false;
    }

    await setTimeout(50);
  }

  return true;
}

async function runGlobalSetup(playwright: TestRunner) {
  const reporter = new LzPlaywrightCollectingReporter();
  const { status } = await playwright.runGlobalSetup([reporter]);

  if (status !== 'passed') {
    throw new Error(
      `Playwright global setup ${status}:\n${reporter.errors.join('\n')}\n${reporter.outputTail}`,
    );
  }
}

function logCoverageGaps(
  log: Logger,
  { lostFrames, sharedFrames }: CoverageGaps,
) {
  if (lostFrames > 0) {
    log.warn(
      `${lostFrames} frame(s) did not answer before their context closed; their coverage is missing, so mutants only they reached show as NoCoverage.`,
    );
  }

  if (sharedFrames > 0) {
    log.info(
      `${sharedFrames} frame(s) belonged to contexts that outlived their test (beforeAll or worker fixtures); their coverage counts as static, so every test runs for those mutants.`,
    );
  }
}
