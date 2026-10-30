// A fake Playwright install that loadPlaywright resolves from the config's folder, as it resolves a real
// one, with a fake TestRunner that plays what Playwright and the worker hook do.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { TestContext } from 'node:test';

import type { FullResult, Reporter } from '@playwright/test/reporter';
import { INSTRUMENTER_CONSTANTS } from '@stryker-mutator/api/core';

import type {
  RunTestsParams,
  TestRunner,
} from '../../src/playwright-internals.ts';
import {
  LzStrykerPlaywrightTestRunner,
  setEnv,
} from '../../src/playwright-test-runner.ts';
import {
  readRunSettings,
  RUN_SETTINGS,
  type RunSettings,
  serializeSnapshot,
  type SnapshotLine,
} from '../../src/protocol.ts';
import {
  LzStrykerCollectingReporter,
  type ReportedTest,
} from '../../src/reporter.ts';
import { finishedTest, logger, strykerOptions, tempTree } from './doubles.ts';

export type Status = FullResult['status'];

export const ACTIVE_MUTANT = INSTRUMENTER_CONSTANTS.ACTIVE_MUTANT_ENV_VARIABLE;
const FAKE = '__fakePlaywright__';

interface Project {
  default: boolean;
  expect?: { timeout?: number };
  project: { name: string; timeout: number };
}

interface WebServer {
  url?: string;
  port?: number;
  ignoreHTTPSErrors?: boolean;
}

/** What one runTests call saw: its params, the run settings and the environment the workers get. */
export interface Run {
  reporter: LzStrykerCollectingReporter;
  params: RunTestsParams;
  settings: RunSettings;
  env: Record<string, string | undefined>;
}

export interface Behaviour {
  projects?: Project[];
  webServers?: WebServer[];
  listed?: ReportedTest[];
  initialize?: () => Promise<void>;
  globalSetup?: (reporter: Reporter) => Status;
  globalTeardown?: () => Promise<void>;
  runTests?: (run: Run) => Promise<Status>;
  urlUp?: (url: URL, ignoreHTTPSErrors: boolean) => Promise<boolean>;
}

/** The fake's record of every call, in order. */
type Call = [string, ...unknown[]];

/** Sets `values` in process.env, an undefined value unsetting its variable, and restores them after the test. */
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
  const live: LzStrykerPlaywrightTestRunner[] = [];
  const globals: Record<string, unknown> = globalThis;

  // Registered first, so the runners are disposed before the folder goes and the temp variables are restored.
  t.after(async () => {
    await Promise.all(live.map((shell) => shell.dispose()));
    delete globals[FAKE];
  });

  const dir = tempTree(t, 'runner-shell-test-', {
    'playwright.config.ts': '',
    'node_modules/@playwright/test/package.json': '{"name":"@playwright/test"}',
    'node_modules/@playwright/test/index.js': '',
    'node_modules/playwright/package.json': JSON.stringify({
      name: 'playwright',
      version,
    }),
    'node_modules/playwright/lib/runner.js': `module.exports = globalThis.${FAKE}.runner;`,
    'node_modules/playwright/lib/common.js': `module.exports = globalThis.${FAKE}.common;`,
    'node_modules/playwright-core/package.json': '{"name":"playwright-core"}',
    'node_modules/playwright-core/lib/coreBundle.js': `module.exports = globalThis.${FAKE}.coreBundle;`,
  });
  const tmp = path.join(dir, 'tmp');
  mkdirSync(tmp);
  const configFile = path.join(dir, 'playwright.config.ts');
  const calls: Call[] = [];
  const runs: Run[] = [];
  let stopRequested = Promise.withResolvers<void>();

  class FakeTestRunner implements TestRunner {
    constructor(configLocation: unknown, overrides: Record<string, unknown>) {
      calls.push(['new', configLocation, overrides]);
    }

    async initialize(params: Record<string, never>) {
      calls.push(['initialize', params]);
      await behaviour.initialize?.();
    }

    async loadConfig() {
      calls.push(['loadConfig']);

      return {
        projects: behaviour.projects ?? [
          { default: true, project: { name: 'chromium', timeout: 30_000 } },
        ],
        webServers: behaviour.webServers ?? [],
      };
    }

    async listTests(
      reporter: Reporter,
      params: { projects?: string[] },
    ): Promise<{ status: Status }> {
      calls.push(['listTests', params]);
      const listed = behaviour.listed ?? [];
      collecting(reporter).onBegin({}, { allTests: () => listed });

      return { status: 'passed' };
    }

    async runGlobalSetup([reporter]: Reporter[]): Promise<{ status: Status }> {
      calls.push(['runGlobalSetup']);
      assert.ok(reporter);

      return {
        status: behaviour.globalSetup?.(reporter) ?? 'passed',
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
          RUN_SETTINGS,
          ACTIVE_MUTANT,
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
      const status = await (behaviour.runTests ?? passAll)(run);

      return { status };
    }

    async stopTests() {
      calls.push(['stopTests']);
      stopRequested.resolve();
    }
  }

  const fake = {
    runner: { testRunner: { TestRunner: FakeTestRunner } },
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
  globals[FAKE] = fake;
  // init() and the temp root read os.tmpdir(), so the fake's own folder stands in for it.
  stubEnv(t, { TMPDIR: tmp, TEMP: tmp, TMP: tmp });

  return {
    dir,
    tmp,
    configFile,
    calls,
    runs,
    names: () => calls.map(([name]) => name),
    /**
     * A runner on `configFile`, unless `lzStrykerPlaywright` overrides it, that the fake's cleanup disposes, and the
     * lines it logs.
     */
    runner: ({
      timeoutMS = 10_000,
      lzStrykerPlaywright = {},
    }: { timeoutMS?: number; lzStrykerPlaywright?: object } = {}) => {
      const { log, lines } = logger();
      const shell = new LzStrykerPlaywrightTestRunner(
        strykerOptions({
          timeoutMS,
          lzStrykerPlaywright: { configFile, ...lzStrykerPlaywright },
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

/** The runner always hands Playwright an LzStrykerCollectingReporter. */
function collecting(reporter: Reporter): LzStrykerCollectingReporter {
  assert.ok(
    reporter instanceof LzStrykerCollectingReporter,
    'an LzStrykerCollectingReporter',
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
