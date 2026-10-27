import { createRequire } from 'node:module';

import type { FullResult, Reporter } from '@playwright/test/reporter';

import type { PageSettings } from './worker-hook.ts';

type Status = FullResult['status'];

export interface RunTestsParams {
  locations: string[];
  testIds?: string[] | undefined;
  projects?: string[] | undefined;
  workers?: number;
  maxFailures?: number | undefined;
  timeout?: number | undefined;
  disableConfigReporters?: boolean;
}

/** The fields of a project of Playwright's loaded config that the runner reads. */
export interface ConfigProject {
  default: boolean;
  expect?: { timeout?: number | undefined } | undefined;
  project: { name: string; timeout: number };
}

/** The fields of a webServer of Playwright's loaded config that the runner reads. */
export interface ConfigWebServer {
  url?: string | undefined;
  port?: number | undefined;
  ignoreHTTPSErrors?: boolean | undefined;
}

/** The runner's calls into Playwright's TestRunner, each result parsed to what the runner reads. */
export interface TestRunner {
  initialize(params: Record<string, never>): Promise<void>;
  loadConfig(): Promise<{
    projects: ConfigProject[];
    webServers: ConfigWebServer[];
  }>;
  // Resolves to undefined when Playwright throws, after printing the error to stderr.
  listTests(
    reporter: Reporter,
    params: { projects?: string[] },
  ): Promise<{ status: Status } | undefined>;
  runGlobalSetup(reporters: Reporter[]): Promise<{ status: Status }>;
  runGlobalTeardown(): Promise<void>;
  runTests(
    reporter: Reporter,
    params: RunTestsParams,
  ): Promise<{ status: Status }>;
  stopTests(): Promise<void>;
}

export const TEST_RUNNER_METHODS = [
  'initialize',
  'loadConfig',
  'listTests',
  'runGlobalSetup',
  'runGlobalTeardown',
  'runTests',
  'stopTests',
] as const satisfies readonly (keyof TestRunner)[];

export interface CoreBundleModule {
  utils: {
    isURLAvailable(url: URL, ignoreHTTPSErrors: boolean): Promise<boolean>;
  };
}

export interface CommonModule {
  configLoader: {
    resolveConfigLocation(configFile: string | undefined): unknown;
  };
}

export const MIN_PLAYWRIGHT: {
  readonly major: number;
  readonly minor: number;
} = { major: 1, minor: 63 };

export const WORKER_ENTRY =
  /[\\/]playwright[\\/]lib[\\/]worker[\\/]workerProcessEntry\.js$/;

/**
 * Turns off the aria snapshot Playwright takes of a failed test's page for its error prompt. On a page
 * stuck in a loop it waits out its 5 s timeout and pushes the run past Stryker's.
 */
export const NO_COPY_PROMPT_ENV = 'PLAYWRIGHT_NO_COPY_PROMPT';

/** The members of a Playwright Frame the worker hook calls; the page function reads one global. */
export interface HookedFrame {
  evaluate(fn: (name: string) => unknown, name: string): Promise<unknown>;
  isDetached(): boolean;
}

/** The members of a Playwright Page the worker hook calls; it replaces `close`. */
export interface HookedPage {
  frames(): HookedFrame[];
  close(options?: unknown): Promise<void>;
}

/** The members of a Playwright Browser the worker hook calls; it replaces `close`. */
export interface HookedBrowser {
  contexts(): HookedContext[];
  close(options?: unknown): Promise<void>;
}

/** The members of a Playwright BrowserContext the worker hook calls. */
export interface HookedContext {
  pages(): HookedPage[];
  browser(): HookedBrowser | null;
  on(event: 'page', handler: (page: HookedPage) => void): unknown;
  addInitScript(
    script: (settings: PageSettings) => void,
    settings: PageSettings,
  ): Promise<unknown>;
}

export interface Instrumentation {
  addListener(listener: {
    runAfterCreateBrowserContext?(context: HookedContext): Promise<void>;
    runBeforeCloseBrowserContext?(context: HookedContext): Promise<void>;
  }): void;
}

export interface Playwright {
  readonly version: string;
  createTestRunner(
    configFile: string | undefined,
    overrides: Record<string, unknown>,
  ): Promise<TestRunner>;
  isURLAvailable: CoreBundleModule['utils']['isURLAvailable'];
}

export function supportsPlaywright(version: string): boolean {
  const [major, minor] = version.split('.').map(Number);

  return major === MIN_PLAYWRIGHT.major && minor >= MIN_PLAYWRIGHT.minor;
}

/**
 * Checks each internal the runner calls, and parses what each TestRunner method resolves to where the
 * runner reads it; whether a method takes the arguments it is given only a run can tell.
 */
export function probeInternals(
  version: string,
  modules: {
    runner: unknown;
    common: unknown;
    coreBundle: unknown;
  },
): Playwright {
  const { runner, common, coreBundle } = modules;
  const testRunner = isRecord(runner) ? runner.testRunner : undefined;
  const TestRunner = isRecord(testRunner) ? testRunner.TestRunner : undefined;
  const configLoader = isRecord(common) ? common.configLoader : undefined;
  const resolveConfigLocation = isRecord(configLoader)
    ? configLoader.resolveConfigLocation
    : undefined;
  const utils = isRecord(coreBundle) ? coreBundle.utils : undefined;
  const isURLAvailable = isRecord(utils) ? utils.isURLAvailable : undefined;

  const changed = () =>
    new Error(
      `Playwright ${version} changed the internals this runner calls (playwright/lib/runner TestRunner with ${TEST_RUNNER_METHODS.join(', ')}; playwright/lib/common configLoader; playwright-core coreBundle isURLAvailable).`,
    );

  if (
    typeof TestRunner !== 'function' ||
    typeof resolveConfigLocation !== 'function' ||
    typeof isURLAvailable !== 'function'
  ) {
    throw changed();
  }

  const prototype: unknown = TestRunner.prototype;
  const methodOf = (name: keyof TestRunner) => {
    const method = isRecord(prototype) ? prototype[name] : undefined;

    if (typeof method !== 'function') {
      throw changed();
    }

    return method;
  };
  const methods = {
    initialize: methodOf('initialize'),
    loadConfig: methodOf('loadConfig'),
    listTests: methodOf('listTests'),
    runGlobalSetup: methodOf('runGlobalSetup'),
    runGlobalTeardown: methodOf('runGlobalTeardown'),
    runTests: methodOf('runTests'),
    stopTests: methodOf('stopTests'),
  };

  return {
    version,
    async createTestRunner(configFile, overrides) {
      const configLocation: unknown = Reflect.apply(
        resolveConfigLocation,
        configLoader,
        [configFile],
      );
      const created: unknown = Reflect.construct(TestRunner, [
        configLocation,
        overrides,
      ]);
      const status = async (
        method: 'listTests' | 'runGlobalSetup' | 'runTests',
        args: readonly unknown[],
      ) => {
        const result: unknown = await Reflect.apply(
          methods[method],
          created,
          args,
        );

        return parseStatus(result, method, version);
      };
      const runner: TestRunner = {
        async initialize(params) {
          await Reflect.apply(methods.initialize, created, [params]);
        },
        async loadConfig() {
          const config: unknown = await Reflect.apply(
            methods.loadConfig,
            created,
            [],
          );

          return parseConfig(config, version);
        },
        async listTests(reporter, params) {
          const result: unknown = await Reflect.apply(
            methods.listTests,
            created,
            [reporter, params],
          );

          return result === undefined
            ? undefined
            : parseStatus(result, 'listTests', version);
        },
        runGlobalSetup: (reporters) => status('runGlobalSetup', [reporters]),
        async runGlobalTeardown() {
          await Reflect.apply(methods.runGlobalTeardown, created, []);
        },
        runTests: (reporter, params) => status('runTests', [reporter, params]),
        async stopTests() {
          await Reflect.apply(methods.stopTests, created, []);
        },
      };
      await runner.initialize({});

      return runner;
    },
    async isURLAvailable(url, ignoreHTTPSErrors) {
      const available: unknown = await Reflect.apply(
        isURLAvailable,
        undefined,
        [url, ignoreHTTPSErrors],
      );

      return available === true;
    },
  };
}

const statuses: readonly Status[] = [
  'passed',
  'failed',
  'timedout',
  'interrupted',
];

function parseStatus(
  value: unknown,
  method: string,
  version: string,
): { status: Status } {
  const status = isRecord(value) ? value.status : undefined;
  const known = statuses.find((candidate) => candidate === status);

  if (known === undefined) {
    throw new Error(
      `Playwright ${version} changed what TestRunner.${method}() resolves to; this runner reads its status: passed, failed, timedout or interrupted.`,
    );
  }

  return { status: known };
}

function parseConfig(
  value: unknown,
  version: string,
): Awaited<ReturnType<TestRunner['loadConfig']>> {
  const changed = () =>
    new Error(
      `Playwright ${version} changed what TestRunner.loadConfig() resolves to; this runner reads projects[].default, ` +
        'project.name, project.timeout and expect.timeout, and webServers[].url, port and ignoreHTTPSErrors.',
    );
  const projects = isRecord(value) ? value.projects : undefined;
  const webServers = isRecord(value) ? value.webServers : undefined;

  if (!Array.isArray(projects) || !Array.isArray(webServers)) {
    throw changed();
  }

  return {
    projects: projects.map((project: unknown): ConfigProject => {
      const settings = isRecord(project) ? project.project : undefined;
      const expect = isRecord(project) ? project.expect : undefined;
      const expectTimeout = isRecord(expect) ? expect.timeout : undefined;

      if (
        !isRecord(project) ||
        typeof project.default !== 'boolean' ||
        !isRecord(settings) ||
        typeof settings.name !== 'string' ||
        typeof settings.timeout !== 'number' ||
        (expect !== undefined && !isRecord(expect)) ||
        (expectTimeout !== undefined && typeof expectTimeout !== 'number')
      ) {
        throw changed();
      }

      return {
        default: project.default,
        expect: expect === undefined ? undefined : { timeout: expectTimeout },
        project: { name: settings.name, timeout: settings.timeout },
      };
    }),
    webServers: webServers.map((server: unknown): ConfigWebServer => {
      if (
        !isRecord(server) ||
        (server.url !== undefined && typeof server.url !== 'string') ||
        (server.port !== undefined && typeof server.port !== 'number') ||
        (server.ignoreHTTPSErrors !== undefined &&
          typeof server.ignoreHTTPSErrors !== 'boolean')
      ) {
        throw changed();
      }

      return {
        url: server.url,
        port: server.port,
        ignoreHTTPSErrors: server.ignoreHTTPSErrors,
      };
    }),
  };
}

export function loadPlaywright(configFile: string | undefined): Playwright {
  const testRequire = createRequire(
    createRequire(configFile ?? `${process.cwd()}/package.json`).resolve(
      '@playwright/test',
    ),
  );
  // playwright-core is a dependency of playwright, not of @playwright/test, so resolve it from
  // playwright for layouts that do not hoist (pnpm).
  const playwrightRequire = createRequire(
    testRequire.resolve('playwright/package.json'),
  );
  const manifest: unknown = playwrightRequire('./package.json');
  const version = String(isRecord(manifest) ? manifest.version : undefined);

  if (!supportsPlaywright(version)) {
    throw new Error(
      `The Playwright test runner needs Playwright ${MIN_PLAYWRIGHT.major}.${MIN_PLAYWRIGHT.minor} or a later ${MIN_PLAYWRIGHT.major}.x release, found ${version}.`,
    );
  }

  return probeInternals(version, {
    runner: playwrightRequire('playwright/lib/runner'),
    common: playwrightRequire('playwright/lib/common'),
    coreBundle: playwrightRequire('playwright-core/lib/coreBundle'),
  });
}

/** The instrumentation of the `playwright-core` module a worker loads. */
export function instrumentationOf(core: unknown): Instrumentation {
  const instrumentation = isRecord(core) ? core._instrumentation : undefined;
  const addListener = isRecord(instrumentation)
    ? instrumentation.addListener
    : undefined;

  if (typeof addListener !== 'function') {
    throw new Error(
      'Playwright changed the internals this runner calls (playwright-core _instrumentation.addListener).',
    );
  }

  return {
    addListener(listener) {
      Reflect.apply(addListener, instrumentation, [listener]);
    },
  };
}

/** What the timeout manager of Playwright 1.63 and 1.64 runs: the test body, hooks, worker teardown, modifiers. */
const SLOT_TYPES = [
  'test',
  'beforeEach',
  'afterEach',
  'beforeAll',
  'afterAll',
  'teardown',
  'skip',
  'slow',
  'fail',
  'fixme',
] as const;

export type SlotType = (typeof SLOT_TYPES)[number];

export interface RunningSlot {
  readonly type: SlotType;
  /** Whether a fixture of that slot is being set up or torn down. */
  readonly inFixture: boolean;
}

/**
 * What the timeout manager of a TestInfo runs now (TestInfo._timeoutManager._running.runnable).
 * Undefined when there is no TestInfo or its timeout manager runs nothing; throws when a TestInfo has
 * no timeout manager or it runs a type this runner does not know.
 */
export function runningSlotOf(
  testInfo: unknown,
  version: string,
): RunningSlot | undefined {
  if (!isRecord(testInfo)) {
    return undefined;
  }

  const manager = testInfo._timeoutManager;

  if (!isRecord(manager)) {
    throw timeoutManagerChanged(version);
  }

  const running = manager._running;
  const runnable = isRecord(running) ? running.runnable : undefined;

  if (!isRecord(runnable)) {
    return undefined;
  }

  if (!isSlotType(runnable.type)) {
    throw timeoutManagerChanged(version);
  }

  return { type: runnable.type, inFixture: runnable.fixture !== undefined };
}

function timeoutManagerChanged(version: string): Error {
  return new Error(
    `Playwright ${version} changed the internals this runner calls (TestInfo._timeoutManager, which tells a test from the hooks and fixtures that serve a group).`,
  );
}

function isSlotType(value: unknown): value is SlotType {
  return SLOT_TYPES.some((type) => type === value);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isSerialSuite(suite: unknown): boolean {
  const mode = isRecord(suite) ? suite._parallelMode : undefined;

  if (typeof mode !== 'string') {
    throw new Error(
      'Playwright suites no longer carry Suite._parallelMode, which this runner reads to keep describe.serial groups together.',
    );
  }

  return mode === 'serial';
}
