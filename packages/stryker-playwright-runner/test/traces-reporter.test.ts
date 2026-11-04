import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import { pathToFileURL } from 'node:url';

import type { schema } from '@stryker-mutator/api/core';

import {
  copySurvivorTraces,
  projectRootEnv,
  tracesDirEnv,
} from '../src/survivor-traces.ts';
import { LzPlaywrightTracesReporter } from '../src/traces-reporter.ts';
import { logger, strykerOptions, tempTree } from './support/doubles.ts';
import { stubEnv } from './support/fake-playwright.ts';

function isolateEnv(t: TestContext): void {
  stubEnv(t, { [tracesDirEnv]: undefined, [projectRootEnv]: undefined });
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

function tracedReporter(survivorTraces: string) {
  const { log, lines } = logger();
  const reporter = new LzPlaywrightTracesReporter(
    strykerOptions({ lzPlaywright: { survivorTraces } }),
    log,
  );

  return { reporter, lines };
}

test('with survivorTraces, the reporter empties the folder, hands its path and the project root to the test runner processes, and warns that tracing changes timing', (t) => {
  isolateEnv(t);
  const dir = path.join(
    tempTree(t, 'lz-traces-reporter-', { 'traces/stale.zip': '' }),
    'traces',
  );

  const { lines } = tracedReporter(dir);

  assert.deepEqual(fs.readdirSync(dir), []);
  assert.equal(process.env[tracesDirEnv], dir);
  assert.equal(process.env[projectRootEnv], process.cwd());
  assert.deepEqual(lines, [
    [
      'warn',
      "lzPlaywright.survivorTraces is set: every test run records a Playwright trace, which can change timing. Compare statuses with an untraced run's report before trusting them.",
    ],
  ]);
});

for (const survivorTraces of ['', '.', '..', path.parse(process.cwd()).root]) {
  test(`the reporter refuses survivorTraces "${survivorTraces}", which holds the project, and empties nothing`, (t) => {
    isolateEnv(t);
    const { log } = logger();

    assert.throws(
      () =>
        new LzPlaywrightTracesReporter(
          strykerOptions({ lzPlaywright: { survivorTraces } }),
          log,
        ),
      /which holds the project, and the lz-playwright-traces reporter empties that folder/,
    );
    assert.equal(process.env[tracesDirEnv], undefined);
    assert.notDeepEqual(fs.readdirSync(process.cwd()), []);
  });
}

test('the reporter accepts a folder outside the project', (t) => {
  isolateEnv(t);
  const dir = path.join(tempTree(t, 'lz-traces-reporter-'), 'traces');

  tracedReporter(dir);

  assert.equal(process.env[tracesDirEnv], dir);
});

test("at the end, the reporter writes index.html with Stryker's report app and each survivor's traces", (t) => {
  isolateEnv(t);
  const dir = path.join(tempTree(t, 'lz-traces-reporter-'), 'traces');
  const { reporter, lines } = tracedReporter(dir);
  copySurvivorTraces(
    { dir, projectRoot: process.cwd() },
    {
      fileName: path.join(process.cwd(), 'src', 'a.ts'),
      mutatorName: 'EqualityOperator',
      replacement: 'a > b',
      location: { start: { line: 0, column: 0 }, end: { line: 0, column: 5 } },
    },
    [],
  );
  lines.length = 0;

  reporter.onMutationTestReportReady(survivingReport);

  const index = path.join(dir, 'index.html');
  const html = fs.readFileSync(index, 'utf8');
  assert.ok(html.includes('var MutationTestElements='));
  assert.ok(html.includes('Traces of this mutant run:'));
  assert.deepEqual(lines, [
    ['info', `Traces of 1 survivor(s): ${pathToFileURL(index).href}`],
  ]);
});

test('at the end, the reporter names the trace folders it could not read', (t) => {
  isolateEnv(t);
  const dir = path.join(tempTree(t, 'lz-traces-reporter-'), 'traces');
  const { reporter, lines } = tracedReporter(dir);
  fs.mkdirSync(path.join(dir, 'broken'));
  fs.mkdirSync(path.join(dir, 'broken-2'));
  lines.length = 0;

  reporter.onMutationTestReportReady(survivingReport);

  const [skipped, ...rest] = lines;
  const prefix = 'Skipped trace folder(s) without a readable mutant.json: ';
  assert.equal(skipped?.[0], 'warn');
  assert.ok(skipped[1].startsWith(prefix));
  assert.deepEqual(skipped[1].slice(prefix.length).split(', ').sort(), [
    path.join(dir, 'broken'),
    path.join(dir, 'broken-2'),
  ]);
  assert.deepEqual(rest, [
    [
      'info',
      `Traces of 0 survivor(s): ${pathToFileURL(path.join(dir, 'index.html')).href}`,
    ],
  ]);
});

test('without survivorTraces, the reporter warns that it does nothing, and leaves the environment and the report alone', (t) => {
  isolateEnv(t);
  const { log, lines } = logger();

  const reporter = new LzPlaywrightTracesReporter(strykerOptions({}), log);
  reporter.onMutationTestReportReady(survivingReport);

  assert.equal(process.env[tracesDirEnv], undefined);
  assert.equal(process.env[projectRootEnv], undefined);
  assert.deepEqual(lines, [
    [
      'warn',
      'The lz-playwright-traces reporter does nothing without lzPlaywright.survivorTraces.',
    ],
  ]);
});
