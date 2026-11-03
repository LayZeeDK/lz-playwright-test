import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import { pathToFileURL } from 'node:url';

import type { schema } from '@stryker-mutator/api/core';

import { copySurvivorTraces } from '../src/survivor-traces.ts';
import { LzPlaywrightTracesReporter } from '../src/traces-reporter.ts';
import { logger, strykerOptions } from './support/doubles.ts';

const envNames = ['LZ_PLAYWRIGHT_TRACES_DIR', 'LZ_PLAYWRIGHT_PROJECT_ROOT'];

function isolateEnv(t: TestContext): void {
  const saved = envNames.map((name) => [name, process.env[name]] as const);
  envNames.forEach((name) => delete process.env[name]);
  t.after(() => {
    saved.forEach(([name, value]) => {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    });
  });
}

function tempDir(t: TestContext): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lz-traces-reporter-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  return dir;
}

const survivingReport: schema.MutationTestResult = {
  schemaVersion: '2',
  thresholds: { high: 80, low: 60 },
  files: {
    'src/a.ts': {
      language: 'typescript',
      source: 'a < b',
      mutants: [
        {
          id: '1',
          mutatorName: 'EqualityOperator',
          replacement: 'a > b',
          status: 'Survived',
          location: {
            start: { line: 1, column: 1 },
            end: { line: 1, column: 6 },
          },
        },
      ],
    },
  },
};

test('with survivorTraces, the reporter empties the folder, hands its path and the project root to the test runner processes, and warns that tracing changes timing', (t) => {
  isolateEnv(t);
  const dir = path.join(tempDir(t), 'traces');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'stale.zip'), '');
  const { log, lines } = logger();

  new LzPlaywrightTracesReporter(
    strykerOptions({ lzPlaywright: { survivorTraces: dir } }),
    log,
  );

  assert.deepEqual(fs.readdirSync(dir), []);
  assert.equal(process.env['LZ_PLAYWRIGHT_TRACES_DIR'], dir);
  assert.equal(process.env['LZ_PLAYWRIGHT_PROJECT_ROOT'], process.cwd());
  assert.deepEqual(lines, [
    [
      'warn',
      "lzPlaywright.survivorTraces is set: every test run records a Playwright trace, which can change timing. Compare statuses with an untraced run's report before trusting them.",
    ],
  ]);
});

test("at the end, the reporter writes index.html with Stryker's report app and each survivor's traces, and names the folders it could not read", (t) => {
  isolateEnv(t);
  const dir = path.join(tempDir(t), 'traces');
  const { log, lines } = logger();
  const reporter = new LzPlaywrightTracesReporter(
    strykerOptions({ lzPlaywright: { survivorTraces: dir } }),
    log,
  );
  copySurvivorTraces(
    dir,
    {
      fileName: 'unused',
      mutatorName: 'EqualityOperator',
      replacement: 'a > b',
      location: { start: { line: 0, column: 0 }, end: { line: 0, column: 5 } },
    },
    'src/a.ts',
    [],
  );
  fs.mkdirSync(path.join(dir, 'broken'));
  fs.mkdirSync(path.join(dir, 'broken-2'));
  lines.length = 0;

  reporter.onMutationTestReportReady(survivingReport);

  const index = path.join(dir, 'index.html');
  const html = fs.readFileSync(index, 'utf8');
  assert.ok(html.includes('var MutationTestElements='));
  assert.ok(html.includes('Traces of this mutant run:'));
  const [skipped, ...rest] = lines;
  const prefix = 'Skipped trace folder(s) without a readable mutant.json: ';
  assert.equal(skipped?.[0], 'warn');
  assert.ok(skipped[1].startsWith(prefix));
  assert.deepEqual(skipped[1].slice(prefix.length).split(', ').sort(), [
    path.join(dir, 'broken'),
    path.join(dir, 'broken-2'),
  ]);
  assert.deepEqual(rest, [
    ['info', `Traces of 1 survivor(s): ${pathToFileURL(index).href}`],
  ]);

  fs.rmSync(path.join(dir, 'broken'), { recursive: true });
  fs.rmSync(path.join(dir, 'broken-2'), { recursive: true });
  lines.length = 0;
  reporter.onMutationTestReportReady(survivingReport);

  assert.deepEqual(lines, [
    ['info', `Traces of 1 survivor(s): ${pathToFileURL(index).href}`],
  ]);
});

test('without survivorTraces, the reporter warns that it does nothing, and leaves the environment and the report alone', (t) => {
  isolateEnv(t);
  const { log, lines } = logger();

  const reporter = new LzPlaywrightTracesReporter(strykerOptions({}), log);
  reporter.onMutationTestReportReady(survivingReport);

  assert.equal(process.env['LZ_PLAYWRIGHT_TRACES_DIR'], undefined);
  assert.equal(process.env['LZ_PLAYWRIGHT_PROJECT_ROOT'], undefined);
  assert.deepEqual(lines, [
    [
      'warn',
      'The lz-playwright-traces reporter does nothing without lzPlaywright.survivorTraces.',
    ],
  ]);
});
