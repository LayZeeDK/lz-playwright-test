// A fake Playwright install that loadPlaywright resolves from the config's folder, as it resolves a real
// one, with a fake TestRunner that plays what Playwright and the worker hook do.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { TestContext } from 'node:test';

import type { FullResult, Reporter } from '@playwright/test/reporter';
import { INSTRUMENTER_CONSTANTS } from '@stryker-mutator/api/core';

import { fieldOf, isRecord } from '../../src/is-record.ts';
import type {
  RunTestsParams,
  TestRunner,
} from '../../src/playwright-internals.ts';
import { LzPlaywrightTestRunner } from '../../src/lz-playwright-test-runner.ts';
import { setEnv } from '../../src/process-env.ts';
import {
  readRunSettings,
  runSettingsEnv,
  type RunSettings,
  serializeSnapshot,
  type SnapshotLine,
} from '../../src/protocol.ts';
import {
  LzPlaywrightCollectingReporter,
  type ReportedSuite,
  type ReportedTest,
} from '../../src/reporter.ts';
import { finishedTest, logger, strykerOptions, tempTree } from './doubles.ts';

export type Status = FullResult['status'];

export const activeMutantEnv =
  INSTRUMENTER_CONSTANTS.ACTIVE_MUTANT_ENV_VARIABLE;
const fakeGlobal = '__fakePlaywright__';
const projectUtils = fieldOf(
  createRequire(import.meta.url)('playwright/lib/runner'),
  'projectUtils',
);
const noProjects = { allTests: () => [], suites: [] };

interface Project {
  readonly default: boolean;
  readonly expect?: { readonly timeout?: number };
  readonly project: {
    readonly name: string;
    readonly timeout: number;
    readonly retries?: number;
    readonly use?: { readonly baseURL?: string };
    readonly dependencies?: readonly string[];
    readonly teardown?: string;
  };
}

interface LoadedProject extends Project {
  readonly project: Project['project'] & { readonly retries: number };
  readonly deps: readonly LoadedProject[];
  readonly teardown: LoadedProject | undefined;
}

interface WebServer {
  readonly url?: string;
  readonly port?: number;
  readonly command?: string;
  readonly ignoreHTTPSErrors?: boolean;
  readonly reuseExistingServer?: boolean;
  readonly env?: Readonly<Record<string, string>>;
}

export type WebServerOptions = Record<string, unknown> & {
  readonly url: string;
};

/** What one runTests call saw: its params, the run settings and the environment the workers get. */
export interface Run {
  readonly reporter: LzPlaywrightCollectingReporter;
  readonly params: RunTestsParams;
  readonly settings: RunSettings;
  readonly env: Record<string, string | undefined>;
}

export interface Behaviour {
  readonly projects?: readonly Project[];
  readonly webServers?: readonly WebServer[];
  readonly failOnFlakyTests?: boolean;
  /** The root suite each run's reporter gets at onBegin. */
  readonly root?: ReportedSuite;
  readonly listed?: readonly ReportedTest[];
  readonly initialize?: () => Promise<void>;
  readonly globalSetup?: (reporter: Reporter) => Status | Promise<Status>;
  readonly globalTeardown?: () => Promise<void>;
  readonly runTests?: (run: Run) => Promise<Status>;
  readonly urlUp?: (url: URL, ignoreHTTPSErrors: boolean) => Promise<boolean>;
}

/** The fake's record of every call, in order. */
type Call = [string, ...unknown[]];

export function stubEnv(
  t: TestContext,
  values: Readonly<Record<string, string | undefined>>,
): void {
  const previous = Object.fromEntries(
    Object.keys(values).map((name) => [name, process.env[name]]),
  );
  t.after(() => setEnv(previous));
  setEnv(values);
}

export function writeSnapshots(run: Run, lines: SnapshotLine[]) {
  writeFileSync(
    path.join(run.settings.outDir, 'worker-1.ndjson'),
    lines.map(serializeSnapshot).join('\n') + '\n',
  );
}

/**
 * Writes a fake Playwright install of `version` next to a config file, with its own temp directory, and
 * returns what the test needs to drive it. Every module of the install reads the fake from globalThis
 * when it loads, which happens inside init().
 */
export function fakePlaywright(
  t: TestContext,
  behaviour: Behaviour = {},
  version = '1.63.0',
) {
  const live: LzPlaywrightTestRunner[] = [];
  const globals: Record<string, unknown> = globalThis;

  // Registered first, so the runners are disposed before the folder goes and the temp variables are restored.
  t.after(async () => {
    await Promise.all(live.map((shell) => shell.dispose()));
    delete globals[fakeGlobal];
  });

  const dir = tempTree(t, 'runner-shell-test-', {
    'playwright.config.ts': '',
    'node_modules/@playwright/test/package.json': '{"name":"@playwright/test"}',
    'node_modules/@playwright/test/index.js': '',
    'node_modules/playwright/package.json': JSON.stringify({
      name: 'playwright',
      version,
    }),
    'node_modules/playwright/lib/runner.js': `module.exports = globalThis.${fakeGlobal}.runner;`,
    'node_modules/playwright/lib/common.js': `module.exports = globalThis.${fakeGlobal}.common;`,
    'node_modules/playwright-core/package.json': '{"name":"playwright-core"}',
    'node_modules/playwright-core/lib/coreBundle.js': `module.exports = globalThis.${fakeGlobal}.coreBundle;`,
  });
  const tmp = path.join(dir, 'tmp');
  mkdirSync(tmp);
  const configFile = path.join(dir, 'playwright.config.ts');
  const calls: Call[] = [];
  const runs: Run[] = [];
  let stopRequested = Promise.withResolvers<void>();
  // Created once, as Playwright creates its webServer plugins at the first load and keeps them.
  const plugins = (behaviour.webServers ?? []).map((server) => ({
    factory: {
      name: 'playwright:webserver',
      _options: {
        ...server,
        url: server.url ?? `http://localhost:${server.port}`,
      } satisfies WebServerOptions,
    },
  }));

  class FakeTestRunner implements TestRunner {
    readonly _configCLIOverrides: Record<string, unknown>;

    constructor(configLocation: unknown, overrides: Record<string, unknown>) {
      calls.push(['new', configLocation, overrides]);
      this._configCLIOverrides = overrides;
    }

    async initialize(params: Record<string, never>) {
      calls.push(['initialize', params]);
      await behaviour.initialize?.();
    }

    async loadConfig() {
      calls.push(['loadConfig']);
      const projects: readonly LoadedProject[] = (
        behaviour.projects ?? [
          { default: true, project: { name: 'chromium', timeout: 30_000 } },
        ]
      ).map((project) => ({
        ...project,
        project: { retries: 0, ...project.project },
        get deps() {
          return projects.filter(({ project: { name } }) =>
            project.project.dependencies?.includes(name),
          );
        },
        get teardown() {
          return projects.find(
            ({ project: { name } }) => name === project.project.teardown,
          );
        },
      }));

      return {
        projects,
        webServers: (behaviour.webServers ?? []).map((server) => ({
          ignoreHTTPSErrors: false,
          reuseExistingServer: false,
          setsNodeOptions: false,
          ...server,
        })),
        plugins,
      };
    }

    async listTests(
      reporter: Reporter,
      params: { projects?: string[] },
    ): Promise<{ status: Status }> {
      calls.push(['listTests', params]);
      const listed = behaviour.listed ?? [];
      collecting(reporter).onBegin(
        { failOnFlakyTests: false },
        { allTests: () => listed },
      );

      return { status: 'passed' };
    }

    async runGlobalSetup([reporter]: Reporter[]): Promise<{ status: Status }> {
      calls.push(['runGlobalSetup']);
      assert.ok(reporter);

      return {
        status: (await behaviour.globalSetup?.(reporter)) ?? 'passed',
      };
    }

    async runGlobalTeardown() {
      calls.push(['runGlobalTeardown']);
      await behaviour.globalTeardown?.();
    }

    async runTests(reporter: Reporter, params: RunTestsParams) {
      const env = Object.fromEntries(
        [
          'NODE_OPTIONS',
          runSettingsEnv,
          activeMutantEnv,
          'PLAYWRIGHT_NO_COPY_PROMPT',
        ].map((name) => [name, process.env[name]]),
      );
      const settings = readRunSettings(env);
      assert.ok(settings);
      const run: Run = {
        reporter: collecting(reporter),
        params,
        env,
        settings,
      };
      calls.push(['runTests']);
      runs.push(run);
      run.reporter.onBegin(
        { failOnFlakyTests: behaviour.failOnFlakyTests ?? false },
        behaviour.root ?? noProjects,
      );
      const status = await (behaviour.runTests ?? passAll)(run);

      return { status };
    }

    async stopTests() {
      calls.push(['stopTests']);
      stopRequested.resolve();
    }
  }

  const fake = {
    runner: { testRunner: { TestRunner: FakeTestRunner }, projectUtils },
    common: {
      configLoader: {
        resolveConfigLocation: (file: string | undefined) => ({
          resolved: file,
        }),
      },
    },
    coreBundle: {
      utils: {
        isURLAvailable: async (url: URL, ignoreHTTPSErrors: boolean) => {
          calls.push(['isURLAvailable', url, ignoreHTTPSErrors]);

          return (await behaviour.urlUp?.(url, ignoreHTTPSErrors)) ?? true;
        },
      },
    },
  };
  globals[fakeGlobal] = fake;
  // init() and the temp root read os.tmpdir(), so the fake's own folder stands in for it.
  stubEnv(t, { TMPDIR: tmp, TEMP: tmp, TMP: tmp });

  return {
    dir,
    tmp,
    configFile,
    calls,
    runs,
    names: () => calls.map(([name]) => name),
    webServerOptions: (): WebServerOptions[] =>
      plugins.map(({ factory }) => factory._options),
    overrides: (): Record<string, unknown> => {
      const overrides = calls.findLast(([name]) => name === 'new')?.[2];
      assert.ok(isRecord(overrides));

      return overrides;
    },
    runner: ({
      timeoutMS = 11_000,
      concurrency = 1,
      checkers = [],
      lzPlaywright = {},
    }: {
      timeoutMS?: number;
      concurrency?: number | string;
      checkers?: readonly string[];
      lzPlaywright?: object;
    } = {}) => {
      const { log, lines } = logger();
      const shell = new LzPlaywrightTestRunner(
        strykerOptions({
          timeoutMS,
          concurrency,
          checkers,
          lzPlaywright: { configFile, ...lzPlaywright },
        }),
        log,
      );
      live.push(shell);

      return { shell, lines };
    },
    /** Resolves when the runner calls stopTests; each await gets the next call. */
    stopped: () => {
      const { promise } = stopRequested;
      stopRequested = Promise.withResolvers<void>();

      return promise;
    },
  };
}

function collecting(reporter: Reporter): LzPlaywrightCollectingReporter {
  assert.ok(
    reporter instanceof LzPlaywrightCollectingReporter,
    'an LzPlaywrightCollectingReporter',
  );

  return reporter;
}

export async function passAll(run: Run): Promise<Status> {
  run.reporter.onTestEnd(finishedTest('a', 'passed'));
  writeSnapshots(run, [
    {
      mutantCoverage: { static: {}, perTest: { a: { '1': 1 } } },
      outlivedItsTest: false,
    },
  ]);

  return 'passed';
}
