import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

import {
  INSTRUMENTER_CONSTANTS,
  type StrykerOptions,
} from '@stryker-mutator/api/core';
import type { Logger } from '@stryker-mutator/api/logging';
import { commonTokens, tokens } from '@stryker-mutator/api/plugin';
import type {
  DryRunOptions,
  DryRunResult,
  MutantRunOptions,
  MutantRunResult,
  TestRunner as StrykerTestRunner,
} from '@stryker-mutator/api/test-runner';

import { readRunnerOptions, type RunnerOptions } from './options.ts';
import {
  loadPlaywright,
  NO_COPY_PROMPT_ENV,
  type Playwright,
  type TestRunner,
} from './playwright-internals.ts';
import { readSnapshotDir, RUN_SETTINGS } from './protocol.ts';
import {
  CollectingReporter,
  type CoverageGaps,
  dryRunRequest,
  dryRunResult,
  listSerialGroups,
  mayHaveLostItsServer,
  mutantRunRequest,
  mutantRunResult,
  projectsThatRun,
  type RunOutput,
  type RunRequest,
  runSettings,
} from './run-result.ts';
import {
  createTempRoot,
  removeDir,
  removeLeftRoots,
  type TempRoot,
} from './temp-root.ts';
import {
  armDeadline,
  assertionTimeoutWarning,
  type ConfigTimeouts,
  configTimeouts,
} from './timeouts.ts';

interface ServerCheck {
  readonly name: string;
  isUp(): Promise<boolean>;
}

/** Everything init() produced, so the run methods never meet a half-initialised runner. */
interface Session {
  readonly options: RunnerOptions;
  readonly playwright: TestRunner;
  readonly root: TempRoot;
  readonly servers: readonly ServerCheck[];
  readonly serialGroups: Map<string, string[]>;
  readonly timeouts: ConfigTimeouts;
}

// `.ts` when this module runs from source, `.js` when it runs from the build.
const HOOK = new URL(
  `./worker-hook${path.extname(import.meta.filename)}`,
  import.meta.url,
).href;

/** The overrides README lists under "On every run". */
const RUN_OVERRIDES = {
  use: { screenshot: 'off', trace: 'off', video: 'off' },
};

/**
 * Hosts Playwright Test in-process through its undocumented TestRunner, which
 * playwright-internals.ts loads, checks and types.
 */
export class PlaywrightTestRunner implements StrykerTestRunner {
  static inject = tokens(commonTokens.options, commonTokens.logger);

  private readonly strykerOptions: StrykerOptions;
  private readonly log: Logger;
  private readonly baseNodeOptions = process.env.NODE_OPTIONS;
  private session?: Session;

  constructor(options: StrykerOptions, log: Logger) {
    this.strykerOptions = options;
    this.log = log;
  }

  capabilities() {
    return { reloadEnvironment: true };
  }

  async init(): Promise<void> {
    const options = readRunnerOptions(this.strykerOptions);
    const pw = loadPlaywright(options.configFile);
    const removed = removeLeftRoots(os.tmpdir());

    if (removed.length) {
      this.log.debug(
        `Removed the temp directories of runners that no longer run: ${removed.join(', ')}`,
      );
    }

    const root = createTempRoot();
    let playwright: TestRunner | undefined;

    try {
      playwright = await pw.createTestRunner(options.configFile, {
        outputDir: root.outputDir,
        ...RUN_OVERRIDES,
      });
      const config = await playwright.loadConfig();
      const timeouts = configTimeouts(config.projects);
      const warning = assertionTimeoutWarning(
        timeouts,
        options.strykerTimeoutMS,
      );

      if (warning) {
        this.log.warn(warning);
      }

      const servers = config.webServers.flatMap((server) =>
        serverCheck(server, pw.isURLAvailable),
      );
      await runGlobalSetup(playwright);
      // Every Stryker test runner process needs the groups, and only one of them runs the dry run.
      // Listed after global setup, like Playwright's own CLI, because test files may read what it
      // creates.
      const serialGroups = await listSerialGroups(
        playwright,
        projectsThatRun(options.projects, config.projects),
      );
      this.session = {
        options,
        playwright,
        root,
        servers,
        serialGroups,
        timeouts,
      };
    } catch (error) {
      // dispose() sees no session, so release what exists here. The init error is the one to report.
      await playwright?.runGlobalTeardown().catch(() => undefined);
      root.remove();
      throw error;
    }
  }

  async dispose(): Promise<void> {
    const session = this.session;
    this.session = undefined;

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
    const request = dryRunRequest(options);
    const { result, gaps } = dryRunResult(
      await this.run(this.ready(), request),
      request,
    );

    if (gaps) {
      logCoverageGaps(this.log, gaps);
    }

    return result;
  }

  async mutantRun(options: MutantRunOptions): Promise<MutantRunResult> {
    const session = this.ready();
    const request = mutantRunRequest(options, session);
    const { result, hitCount } = mutantRunResult(
      await this.run(session, request),
      request,
    );
    this.log.debug(
      `Mutant ${request.activeMutant}: ${result.status}, hitCount ${hitCount}/${request.hitLimit}`,
    );

    return result;
  }

  private ready(): Session {
    if (!this.session) {
      throw new Error(
        'The Playwright test runner was used before init() finished.',
      );
    }

    return this.session;
  }

  // The deadline starts here: the server probe, a restart and a second runOnce all count against
  // Stryker's one timer.
  private async run(session: Session, request: RunRequest): Promise<RunOutput> {
    const deadlineAt =
      request.budget.deadlineMs === undefined
        ? undefined
        : performance.now() + request.budget.deadlineMs;
    await this.restartDeadServers(session);
    let output = await this.runOnce(session, request, deadlineAt);

    // A server that died during this run fails its tests for a reason the mutant did not cause.
    if (
      mayHaveLostItsServer(output) &&
      (await this.restartDeadServers(session))
    ) {
      output = await this.runOnce(session, request, deadlineAt);
    }

    return output;
  }

  private async runOnce(
    session: Session,
    request: RunRequest,
    deadlineAt: number | undefined,
  ): Promise<RunOutput> {
    const outDir = session.root.nextRunDir();
    const reporter = new CollectingReporter();
    const deadline = armDeadline(deadlineAt, () =>
      session.playwright.stopTests(),
    );

    try {
      // Only the workers this run forks see these; the webServer started earlier never does.
      const { status } = await withEnv(
        {
          NODE_OPTIONS:
            `${this.baseNodeOptions ?? ''} --import "${HOOK}"`.trim(),
          [RUN_SETTINGS]: JSON.stringify(runSettings(request, outDir)),
          [INSTRUMENTER_CONSTANTS.ACTIVE_MUTANT_ENV_VARIABLE]:
            request.kind === 'mutant' ? request.activeMutant : undefined,
          [NO_COPY_PROMPT_ENV]: '1',
        },
        () =>
          session.playwright.runTests(reporter, {
            locations: [],
            testIds: request.kind === 'mutant' ? request.testFilter : undefined,
            projects: session.options.projects,
            workers: session.options.workers,
            maxFailures: request.disableBail ? undefined : 1,
            timeout: request.budget.testTimeout,
            disableConfigReporters: true,
          }),
      );
      const { firedAt } = deadline;

      if (firedAt !== undefined) {
        this.log.debug(
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
  private async restartDeadServers(session: Session): Promise<boolean> {
    const up = await Promise.all(
      session.servers.map((server) => server.isUp()),
    );
    const dead = session.servers.filter((_, index) => !up[index]);

    if (dead.length === 0) {
      return false;
    }

    const names = dead.map((server) => server.name).join(', ');
    this.log.warn(
      `webServer at ${names} stopped answering; rerunning Playwright global setup (global teardown runs first).`,
    );
    await runGlobalSetup(session.playwright);

    return true;
  }
}

/**
 * Sets `values` (undefined deletes) while `fn` runs and restores the previous values afterwards, on
 * success and on throw.
 */
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

function setEnv(values: Readonly<Record<string, string | undefined>>) {
  for (const [name, value] of Object.entries(values)) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
}

export function acceptsConnections(
  port: number,
  connect: (options: net.TcpNetConnectOpts) => net.Socket = net.connect,
): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: 'localhost', port, timeout: 5000 });
    const done = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
    socket.once('timeout', () => done(false));
  });
}

async function runGlobalSetup(playwright: TestRunner) {
  const reporter = new CollectingReporter();
  const { status } = await playwright.runGlobalSetup([reporter]);

  if (status !== 'passed') {
    throw new Error(
      `Playwright global setup ${status}:\n${reporter.errors.join('\n')}\n${reporter.output}`,
    );
  }
}

// The same test Playwright's webServer plugin uses at startup: an HTTP request for a url, a TCP
// connection for a port.
function serverCheck(
  server: { url?: string; port?: number; ignoreHTTPSErrors?: boolean },
  isURLAvailable: Playwright['isURLAvailable'],
): ServerCheck[] {
  if (server.url) {
    const url = new URL(server.url);

    return [
      {
        name: server.url,
        isUp: () => isURLAvailable(url, !!server.ignoreHTTPSErrors),
      },
    ];
  }

  const port = server.port;

  return port === undefined
    ? []
    : [{ name: `port ${port}`, isUp: () => acceptsConnections(port) }];
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
