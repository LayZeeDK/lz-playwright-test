import { createRequire } from 'node:module';
import { inspect } from 'node:util';

import type { FullResult, Reporter } from '@playwright/test/reporter';

import { fieldOf, isRecord, isStringArray } from './is-record.ts';
import type { PageSettings } from './protocol.ts';

type Status = FullResult['status'];

export interface RunTestsParams {
  readonly locations: readonly string[];
  readonly testIds?: readonly string[] | undefined;
  readonly projects?: readonly string[] | undefined;
  readonly workers?: number;
  readonly maxFailures?: number | undefined;
  readonly timeout?: number | undefined;
  readonly disableConfigReporters?: boolean;
}

export interface ConfigProject {
  readonly default: boolean;
  readonly expect?: { readonly timeout?: number | undefined } | undefined;
  readonly project: {
    readonly name: string;
    readonly timeout: number;
    readonly retries: number;
    readonly dependencies?: readonly string[] | undefined;
    readonly teardown?: string | undefined;
  };
  readonly baseURL?: string | undefined;
}

export interface ConfigWebServer {
  readonly url?: string | undefined;
  /**
   * The port to check with a TCP connection instead of fetching the url, as Playwright's `checkPortOnly`
   * does: the config's port, or the url's port when the config sets a port that is not `undefined` next to
   * a url.
   */
  readonly port?: number | undefined;
  readonly ignoreHTTPSErrors: boolean;
  readonly reuseExistingServer: boolean;
  /** Whether its `env` sets NODE_OPTIONS, which Playwright puts over the runner's process.env. */
  readonly setsNodeOptions: boolean;
}

export interface TestRunner {
  initialize(params: Record<string, never>): Promise<void>;
  loadConfig(): Promise<{
    readonly projects: readonly ConfigProject[];
    readonly webServers: readonly ConfigWebServer[];
  }>;
  // Resolves to undefined when Playwright throws, after printing the error to stderr.
  listTests(
    reporter: Reporter,
    params: { readonly projects?: readonly string[] },
  ): Promise<{ readonly status: Status } | undefined>;
  runGlobalSetup(
    reporters: readonly Reporter[],
  ): Promise<{ readonly status: Status }>;
  runGlobalTeardown(): Promise<void>;
  runTests(
    reporter: Reporter,
    params: RunTestsParams,
  ): Promise<{ readonly status: Status }>;
  stopTests(): Promise<void>;
}

export interface ConfigHandles {
  /**
   * The live `_options` of the webServer plugin at `index` among the webServer plugins the last loadConfig()
   * created. Global setup starts that webServer from them.
   */
  webServerOptions(index: number): Record<string, unknown>;
  /** The CLI overrides Playwright merges over each project's use. */
  cliOverrides(): Record<string, unknown>;
}

export const testRunnerMethods = [
  'initialize',
  'loadConfig',
  'listTests',
  'runGlobalSetup',
  'runGlobalTeardown',
  'runTests',
  'stopTests',
] as const satisfies readonly (keyof TestRunner)[];

export interface CoreBundleModule {
  readonly utils: {
    isURLAvailable(url: URL, ignoreHTTPSErrors: boolean): Promise<boolean>;
  };
}

export interface CommonModule {
  readonly configLoader: {
    resolveConfigLocation(configFile: string | undefined): unknown;
  };
}

export const minPlaywright: {
  readonly major: number;
  readonly minor: number;
} = { major: 1, minor: 63 };

export const workerEntry =
  /[\\/]playwright[\\/]lib[\\/]worker[\\/]workerProcessEntry\.js$/;

/**
 * Turns off the aria snapshot Playwright takes of a failed test's page for its error prompt. On a page
 * stuck in a loop it waits out its 5 s timeout and pushes the run past Stryker's.
 */
export const noCopyPromptEnv = 'PLAYWRIGHT_NO_COPY_PROMPT';

export interface HookedFrame {
  evaluate(fn: (name: string) => unknown, name: string): Promise<unknown>;
  isDetached(): boolean;
}

export interface HookedPage {
  frames(): HookedFrame[];
  close(options?: unknown): Promise<void>;
}

export interface HookedBrowser {
  contexts(): HookedContext[];
  close(options?: unknown): Promise<void>;
}

export interface HookedContext {
  pages(): HookedPage[];
  browser(): HookedBrowser | null;
  on(event: 'page', handler: (page: HookedPage) => void): unknown;
  addInitScript(
    script: (settings: PageSettings) => void,
    settings: PageSettings,
  ): Promise<unknown>;
  route(
    url: (url: URL) => boolean,
    handler: (route: HookedRoute) => Promise<void>,
  ): Promise<unknown>;
}

export interface HookedRoute {
  request(): { headers(): Record<string, string> };
  fallback(options?: {
    readonly headers: Readonly<Record<string, string>>;
  }): Promise<void>;
}

export interface FetchOptions {
  readonly headers?: Readonly<Record<string, string>> | undefined;
  readonly [option: string]: unknown;
}

export interface HookedRequestContext {
  readonly fetch: (
    target: string | { headers(): Record<string, string> },
    options?: FetchOptions,
  ) => Promise<unknown>;
}

export interface Instrumentation {
  addListener(listener: {
    runAfterCreateBrowserContext?(context: HookedContext): Promise<void>;
    runBeforeCloseBrowserContext?(context: HookedContext): Promise<void>;
    runAfterCreateRequestContext?(context: HookedRequestContext): Promise<void>;
  }): void;
}

export interface Playwright {
  readonly version: string;
  createTestRunner(
    configFile: string | undefined,
    overrides: Record<string, unknown>,
  ): Promise<TestRunner & ConfigHandles>;
  readonly isURLAvailable: CoreBundleModule['utils']['isURLAvailable'];
}

export function supportsPlaywright(version: string): boolean {
  const [major, minor = NaN] = version.split('.').map(Number);

  return major === minPlaywright.major && minor >= minPlaywright.minor;
}

export function probeInternals(
  version: string,
  modules: {
    runner: unknown;
    common: unknown;
    coreBundle: unknown;
  },
): Playwright {
  const { runner, common, coreBundle } = modules;
  const TestRunner = fieldOf(fieldOf(runner, 'testRunner'), 'TestRunner');
  const configLoader = fieldOf(common, 'configLoader');
  const resolveConfigLocation = fieldOf(configLoader, 'resolveConfigLocation');
  const isURLAvailable = fieldOf(
    fieldOf(coreBundle, 'utils'),
    'isURLAvailable',
  );

  const changed = () =>
    internalsChanged(
      version,
      `playwright/lib/runner TestRunner with ${testRunnerMethods.join(', ')}; playwright/lib/common configLoader; playwright-core coreBundle isURLAvailable`,
    );

  if (
    typeof TestRunner !== 'function' ||
    typeof resolveConfigLocation !== 'function' ||
    typeof isURLAvailable !== 'function'
  ) {
    throw changed();
  }

  const methodOf = (source: unknown, name: keyof TestRunner) => {
    const method = fieldOf(source, name);

    if (typeof method !== 'function') {
      throw changed();
    }

    return method;
  };
  const prototype: unknown = TestRunner.prototype;
  const methods = Object.fromEntries(
    testRunnerMethods.map((name) => [name, methodOf(prototype, name)]),
  );

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
      const call = (
        name: keyof TestRunner,
        args: readonly unknown[],
      ): unknown => Reflect.apply(methodOf(methods, name), created, args);
      const status = async (
        method: 'runGlobalSetup' | 'runTests',
        args: readonly unknown[],
      ) => parseStatus(await call(method, args), method, version);
      let loaded: unknown;
      const handlesChanged = () =>
        internalsChanged(
          version,
          `TestRunner._configCLIOverrides and loadConfig() resolving to plugins[].factory named ${webServerPluginName} with _options`,
        );
      const runner: TestRunner & ConfigHandles = {
        async initialize(params) {
          await call('initialize', [params]);
        },
        async loadConfig() {
          loaded = await call('loadConfig', []);

          return parseConfig(loaded, version);
        },
        async listTests(reporter, params) {
          const result = await call('listTests', [reporter, params]);

          return result === undefined
            ? undefined
            : parseStatus(result, 'listTests', version);
        },
        runGlobalSetup: (reporters) => status('runGlobalSetup', [reporters]),
        async runGlobalTeardown() {
          await call('runGlobalTeardown', []);
        },
        runTests: (reporter, params) => status('runTests', [reporter, params]),
        async stopTests() {
          await call('stopTests', []);
        },
        webServerOptions(index) {
          const plugins = fieldOf(loaded, 'plugins');

          if (!Array.isArray(plugins)) {
            throw handlesChanged();
          }

          const options = plugins.flatMap((plugin: unknown) => {
            const factory = fieldOf(plugin, 'factory');
            const pluginOptions = fieldOf(factory, '_options');

            return fieldOf(factory, 'name') === webServerPluginName &&
              isRecord(pluginOptions)
              ? [pluginOptions]
              : [];
          })[index];

          if (!options) {
            throw handlesChanged();
          }

          return options;
        },
        cliOverrides() {
          const overrides = fieldOf(created, '_configCLIOverrides');

          if (!isRecord(overrides)) {
            throw handlesChanged();
          }

          return overrides;
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
  const status = fieldOf(value, 'status');
  const known = statuses.find((candidate) => candidate === status);

  if (known === undefined) {
    throw internalsChanged(
      version,
      `TestRunner.${method}() resolving to a status of passed, failed, timedout or interrupted`,
    );
  }

  return { status: known };
}

function parseConfig(
  value: unknown,
  version: string,
): Awaited<ReturnType<TestRunner['loadConfig']>> {
  const changed = () =>
    internalsChanged(
      version,
      'TestRunner.loadConfig() resolving to projects[].default, project.name, project.timeout, project.retries, ' +
        'project.dependencies, project.teardown and expect.timeout, and webServers[].url, port and ignoreHTTPSErrors',
    );
  const projects = fieldOf(value, 'projects');
  const webServers = fieldOf(value, 'webServers');

  if (!Array.isArray(projects) || !Array.isArray(webServers)) {
    throw changed();
  }

  return {
    projects: projects.map((project: unknown): ConfigProject => {
      const settings = fieldOf(project, 'project');
      const expect = fieldOf(project, 'expect');
      const expectTimeout = fieldOf(expect, 'timeout') ?? undefined;
      const retries = fieldOf(settings, 'retries');
      const baseURL = fieldOf(fieldOf(settings, 'use'), 'baseURL');
      const dependencies = fieldOf(settings, 'dependencies') ?? [];
      const teardown = fieldOf(settings, 'teardown');

      if (
        !isRecord(project) ||
        !isRecord(settings) ||
        typeof settings['name'] !== 'string' ||
        typeof settings['timeout'] !== 'number' ||
        typeof retries !== 'number' ||
        !isStringArray(dependencies) ||
        (teardown !== undefined && typeof teardown !== 'string') ||
        (expect !== undefined && !isRecord(expect)) ||
        (expectTimeout !== undefined && typeof expectTimeout !== 'number')
      ) {
        throw changed();
      }

      return {
        default: !!project['default'],
        expect: expect === undefined ? undefined : { timeout: expectTimeout },
        project: {
          name: settings['name'],
          timeout: settings['timeout'],
          retries,
          dependencies,
          teardown,
        },
        ...(typeof baseURL === 'string' ? { baseURL } : {}),
      };
    }),
    webServers: webServers.map((server: unknown): ConfigWebServer => {
      const configUrl = fieldOf(server, 'url') || undefined;
      const url = configUrl instanceof URL ? configUrl.href : configUrl;
      const configPort = fieldOf(server, 'port');
      const port = configPort || undefined;

      if (!isRecord(server)) {
        throw misconfigured('webServer', 'an object', server);
      }

      if (url !== undefined && typeof url !== 'string') {
        throw misconfigured('webServer.url', 'a string or a URL', url);
      }

      if (
        port !== undefined &&
        typeof port !== 'number' &&
        !(typeof port === 'string' && /^\d+$/.test(port))
      ) {
        throw misconfigured(
          'webServer.port',
          'a number or a string of digits',
          port,
        );
      }

      const checkedPort =
        url !== undefined && configPort !== undefined
          ? new URL(url).port
          : port;
      const env = server['env'];

      return {
        url,
        port: checkedPort === undefined ? undefined : Number(checkedPort),
        ignoreHTTPSErrors: !!server['ignoreHTTPSErrors'],
        reuseExistingServer: !!server['reuseExistingServer'],
        setsNodeOptions: isRecord(env) && env['NODE_OPTIONS'] !== undefined,
      };
    }),
  };
}

const webServerPluginName = 'playwright:webserver';

/**
 * Playwright's runTests sets retries to 0 for every project (playwright 1.64.1 lib/runner/index.js:7010). Its
 * dispatcher reads each test's retries from the TestCase objects that onBegin receives (lib/runner/index.js:6128,
 * set at lib/common/index.js:2060), so the runner raises them there. A test whose describe.configure({ retries })
 * set a number keeps it, unless that number is 0. Each project suite is titled with its project's name
 * (lib/runner/index.js:6614).
 */
export function raiseRetries(
  suite: unknown,
  retriesByProject: ReadonlyMap<string, number>,
): void {
  const projects = fieldOf(suite, 'suites');

  if (!Array.isArray(projects)) {
    throw retriesChanged();
  }

  projects.forEach((project: unknown) => {
    const title = fieldOf(project, 'title');
    const allTests = fieldOf(project, 'allTests');
    const retries =
      typeof title === 'string' ? retriesByProject.get(title) : undefined;

    if (retries === undefined || typeof allTests !== 'function') {
      throw retriesChanged();
    }

    const tests: unknown = allTests.call(project);

    if (!Array.isArray(tests)) {
      throw retriesChanged();
    }

    tests.forEach((test: unknown) => {
      if (!isRecord(test) || typeof test['retries'] !== 'number') {
        throw retriesChanged();
      }

      if (test['retries'] === 0) {
        test['retries'] = retries;
      }
    });
  });
}

function retriesChanged(): Error {
  return internalsChanged(
    undefined,
    'the root suite onBegin receives, with project suites and TestCase.retries',
  );
}

export function playwrightVersion(
  playwrightRequire: (id: string) => unknown,
): string {
  const version = fieldOf(
    playwrightRequire('playwright/package.json'),
    'version',
  );

  if (typeof version !== 'string') {
    throw internalsChanged(
      undefined,
      'playwright/package.json with a string version',
    );
  }

  return version;
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
  const version = playwrightVersion(playwrightRequire);

  if (!supportsPlaywright(version)) {
    throw new Error(
      `The Playwright test runner needs Playwright ${minPlaywright.major}.${minPlaywright.minor} or a later ${minPlaywright.major}.x release, found ${version}.`,
    );
  }

  return probeInternals(version, {
    runner: playwrightRequire('playwright/lib/runner'),
    common: playwrightRequire('playwright/lib/common'),
    coreBundle: playwrightRequire('playwright-core/lib/coreBundle'),
  });
}

export function instrumentationOf(
  core: unknown,
  version: string,
): Instrumentation {
  const instrumentation = fieldOf(core, '_instrumentation');
  const addListener = fieldOf(instrumentation, 'addListener');

  if (typeof addListener !== 'function') {
    throw internalsChanged(
      version,
      'playwright-core _instrumentation.addListener',
    );
  }

  return {
    addListener(listener) {
      Reflect.apply(addListener, instrumentation, [listener]);
    },
  };
}

/** What the timeout manager of Playwright 1.63 and 1.64 runs: the test body, hooks, worker teardown, modifiers. */
const slotTypes = [
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

export type SlotType = (typeof slotTypes)[number];

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

  const manager = testInfo['_timeoutManager'];

  if (!isRecord(manager)) {
    throw timeoutManagerChanged(version);
  }

  const runnable = fieldOf(manager['_running'], 'runnable');

  if (!isRecord(runnable)) {
    return undefined;
  }

  if (!isSlotType(runnable['type'])) {
    throw timeoutManagerChanged(version);
  }

  return {
    type: runnable['type'],
    inFixture: runnable['fixture'] !== undefined,
  };
}

function misconfigured(field: string, expected: string, value: unknown): Error {
  return new Error(
    `The Playwright config's ${field} must be ${expected}, got ${inspect(value)}.`,
  );
}

function timeoutManagerChanged(version: string): Error {
  return internalsChanged(
    version,
    'TestInfo._timeoutManager, which tells a test from the hooks and fixtures that serve a group',
  );
}

export function internalsChanged(
  version: string | undefined,
  what: string,
): Error {
  const playwright =
    version === undefined ? 'Playwright' : `Playwright ${version}`;

  return new Error(
    `${playwright} changed the internals this runner calls (${what}).`,
  );
}

function isSlotType(value: unknown): value is SlotType {
  return slotTypes.some((type) => type === value);
}

export function isSerialSuite(suite: unknown, version: string): boolean {
  const mode = fieldOf(suite, '_parallelMode');

  if (typeof mode !== 'string') {
    throw internalsChanged(
      version,
      'Suite._parallelMode, which keeps describe.serial groups together',
    );
  }

  return mode === 'serial';
}
