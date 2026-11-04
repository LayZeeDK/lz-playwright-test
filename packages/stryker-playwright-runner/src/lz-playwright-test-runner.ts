import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { setTimeout } from 'node:timers/promises';

import { INSTRUMENTER_CONSTANTS, type Mutant } from '@stryker-mutator/api/core';
import type { Logger } from '@stryker-mutator/api/logging';
import { commonTokens, tokens } from '@stryker-mutator/api/plugin';
import type {
  DryRunOptions,
  DryRunResult,
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
  type ConfigWebServer,
  isSerialSuite,
  loadPlaywright,
  noCopyPromptEnv,
  type Playwright,
  type TestRunner,
} from './playwright-internals.ts';
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
  serverMutantFor,
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
  listSerialGroups,
  projectsThatRun,
  type SerialGroups,
} from './serial-groups.ts';
import {
  anyHooked,
  forgetHooked,
  hostKey,
  readServerSupport,
  serverDirEnv,
  type ServerSupport,
  serverSupportEnv,
  writeServerControl,
} from './server-protocol.ts';
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

interface ServerCheck {
  readonly name: string;
  isUp(): Promise<boolean>;
}

/** The webServer side of a session, when server support is on. */
interface ServerSide {
  /** Holds the control file and the hooked marks of the processes global setup starts. */
  readonly dir: string;
  readonly testIdHosts: readonly string[] | undefined;
}

interface Session {
  readonly options: RunnerOptions;
  readonly playwright: TestRunner;
  readonly root: TempRoot;
  readonly servers: readonly ServerCheck[];
  readonly server: ServerSide | undefined;
  readonly serialGroups: SerialGroups;
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
  #session: Session | undefined;
  /** The static mutant the webServer last started with. */
  #serverMutant: string | undefined;

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
    const traces = readTracesTarget(options.survivorTraces, process.env);
    const pw = loadPlaywright(options.configFile);
    const root = claimTempRoot((removed) => {
      if (removed.length) {
        this.#log.debug(
          `Removed the temp directories of runners that no longer run: ${removed.join(', ')}`,
        );
      }
    });
    let playwright: TestRunner | undefined;

    try {
      playwright = await pw.createTestRunner(options.configFile, {
        outputDir: root.outputDir,
        ...runOverrides({
          traced: traces !== undefined,
          screenshots: options.traceScreenshots,
        }),
      });
      const config = await playwright.loadConfig();
      const timeouts = configTimeouts(config.projects);
      const retriesByProject = configRetries(config.projects, options.retries);
      const warning = assertionTimeoutWarning(
        timeouts,
        options.strykerTimeoutMS,
        Math.max(0, ...retriesByProject.values()),
      );

      if (warning) {
        this.#log.warn(warning);
      }

      const servers = config.webServers.flatMap((server) =>
        serverCheck(server, pw.isURLAvailable),
      );
      const server = await serverSide(
        readServerSupport(process.env),
        root,
        config.webServers,
        pw.isURLAvailable,
      );
      await this.#globalSetup(playwright, server, undefined);
      // Every Stryker test runner process needs the groups, and only one of them runs the dry run.
      // Listed after global setup, like Playwright's own CLI, because test files may read what it
      // creates.
      const serialGroups = await listSerialGroups(
        playwright,
        projectsThatRun(options.projects, config.projects),
        (suite) => isSerialSuite(suite, pw.version),
      );
      this.#session = {
        options,
        playwright,
        root,
        servers,
        server,
        serialGroups,
        timeouts,
        retriesByProject,
        traces,
      };
    } catch (error) {
      await playwright?.runGlobalTeardown().catch(() => undefined);

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

    return result;
  }

  async mutantRun(options: MutantRunOptions): Promise<MutantRunResult> {
    const session = this.#ready();
    const request = mutantRunRequest(options, session);
    const output = await this.#run(session, request);
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

  #ready(): Session {
    if (!this.#session) {
      throw new Error(
        'The Playwright test runner was used before init() finished.',
      );
    }

    return this.#session;
  }

  async #run(session: Session, request: RunRequest): Promise<RunOutput> {
    await this.#serveMutant(session, serverMutantFor(request));
    const deadlineAt =
      request.budget.deadlineMs === undefined
        ? undefined
        : performance.now() + request.budget.deadlineMs;
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

  async #serveMutant(session: Session, mutant: string | undefined) {
    if (!session.server || mutant === this.#serverMutant) {
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
      throw new Error(
        `${serverSupportEnv} is on, but no process that Playwright global setup started loaded the server hook. ` +
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
export async function serverSide(
  support: ServerSupport | undefined,
  root: Pick<TempRoot, 'dir'>,
  webServers: readonly ConfigWebServer[],
  isURLAvailable: Playwright['isURLAvailable'],
): Promise<ServerSide | undefined> {
  if (!support) {
    return undefined;
  }

  if (webServers.some((server) => server.setsNodeOptions)) {
    throw new Error(
      `${serverSupportEnv} is on, but a webServer's env sets NODE_OPTIONS, which replaces the one that loads ` +
        'the server hook. Set NODE_OPTIONS in the environment that runs Stryker instead.',
    );
  }

  const reused = webServers
    .filter((server) => server.reuseExistingServer)
    .flatMap((server) => serverCheck(server, isURLAvailable));
  const up = await Promise.all(reused.map((server) => server.isUp()));
  const shared = reused.filter((_, index) => up[index]);

  if (shared.length > 0) {
    throw new Error(
      `${serverSupportEnv} is on, but the webServer at ${shared.map((server) => server.name).join(', ')} ` +
        'already answers and reuseExistingServer is true. Only the Stryker process that started a server can ' +
        'switch its mutant: give each process its own port from STRYKER_MUTATOR_WORKER, and stop your own server.',
    );
  }

  const dir = path.join(root.dir, 'server');
  fs.mkdirSync(dir, { recursive: true });

  return {
    dir,
    testIdHosts:
      support.mode === 'header' ? webServers.flatMap(serverHosts) : undefined,
  };
}

function serverHosts(server: ConfigWebServer): string[] {
  const target = serverTarget(server);

  if (target === undefined) {
    return [];
  }

  return [
    'port' in target
      ? `localhost:${target.port}`
      : hostKey(new URL(target.url)),
  ];
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

export async function withEnv<T>(
  values: Readonly<Record<string, string | undefined>>,
  fn: () => Promise<T>,
): Promise<T> {
  const previous = Object.fromEntries(
    Object.keys(values).map((name) => [name, process.env[name]]),
  );
  setEnv(values);

  try {
    return await fn();
  } finally {
    setEnv(previous);
  }
}

export function setEnv(values: Readonly<Record<string, string | undefined>>) {
  Object.entries(values).forEach(([name, value]) => {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  });
}

// Playwright's own webServer port check tries both loopback addresses: localhost can resolve to only one of them.
const loopbackHosts = ['127.0.0.1', '::1'];

export interface ConnectingSocket {
  once(event: 'connect' | 'error' | 'timeout', listener: () => void): unknown;
  destroy(): unknown;
}

export function acceptsConnections(
  port: number,
  connect: (options: net.TcpNetConnectOpts) => ConnectingSocket = net.connect,
): Promise<boolean> {
  return new Promise((resolve) => {
    let answered = 0;

    loopbackHosts.forEach((host) => {
      const socket = connect({ host, port, timeout: 5000 });
      const done = (ok: boolean) => {
        socket.destroy();
        answered += 1;

        if (ok || answered === loopbackHosts.length) {
          resolve(ok);
        }
      };
      socket.once('connect', () => done(true));
      socket.once('error', () => done(false));
      socket.once('timeout', () => done(false));
    });
  });
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

export type ServerTarget = { readonly port: number } | { readonly url: string };

export function serverTarget({
  url,
  port,
}: ConfigWebServer): ServerTarget | undefined {
  if (port !== undefined) {
    return { port };
  }

  return url === undefined ? undefined : { url };
}

function serverCheck(
  server: ConfigWebServer,
  isURLAvailable: Playwright['isURLAvailable'],
): ServerCheck[] {
  const target = serverTarget(server);

  if (target === undefined) {
    return [];
  }

  if ('port' in target) {
    const { port } = target;

    return [
      {
        name: server.url ?? `port ${port}`,
        isUp: () => acceptsConnections(port),
      },
    ];
  }

  const url = new URL(target.url);

  return [
    {
      name: target.url,
      isUp: () => isURLAvailable(url, server.ignoreHTTPSErrors),
    },
  ];
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
