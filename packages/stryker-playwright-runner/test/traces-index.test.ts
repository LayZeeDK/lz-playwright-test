import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import type { schema } from '@stryker-mutator/api/core';

import { copySurvivorTraces, mutantFile } from '../src/survivor-traces.ts';
import {
  describeSurvivors,
  indexHtml,
  readTraceFolders,
} from '../src/traces-index.ts';
import { addAttempt, fakeTestCase, tempTree } from './support/doubles.ts';

const location = {
  start: { line: 9, column: 7 },
  end: { line: 9, column: 30 },
};

function report(
  ...mutants: Pick<schema.MutantResult, 'id' | 'status' | 'replacement'>[]
): schema.MutationTestResult {
  return {
    schemaVersion: '2',
    thresholds: { high: 80, low: 60 },
    config: { configFile: 'stryker.config.ts' },
    files: {
      'src/price-tag.tsx': {
        language: 'typescript',
        source: '',
        mutants: mutants.map((mutant) => ({
          mutatorName: 'EqualityOperator',
          location,
          ...mutant,
        })),
      },
    },
  };
}

test('a survivor without a trace folder says its result has no trace from this run, and other mutants stay as they are', () => {
  const killed = { id: '2', status: 'Killed', replacement: 'a > b' } as const;

  const described = describeSurvivors(
    report({ id: '1', status: 'Survived', replacement: 'a < b' }, killed),
    new Map(),
  );
  const [survivor, other] = described.files['src/price-tag.tsx']?.mutants ?? [];

  assert.equal(
    survivor?.description,
    [
      'No trace from this run: incremental mode reused this result, or copying its traces failed. Recheck it to record one.',
      'Recheck this mutant after a test change:',
      '  npx stryker run "stryker.config.ts" --mutate "src/price-tag.tsx:9:6-9:29"',
    ].join('\n'),
  );
  assert.deepEqual(other, {
    mutatorName: 'EqualityOperator',
    location,
    ...killed,
  });
});

test('a survivor with a trace folder lists one show-trace command per attempt, marking retries, and its recheck command', () => {
  const dir = path.join(
    'D:/p/reports/lz-playwright-traces',
    'src-price-tag-tsx-9-7-9-30-EqualityOperator-a-b-1234abcd',
  );
  const folders = new Map([
    [
      'src/price-tag.tsx@9:7-9:30\nEqualityOperator: a < b',
      {
        dir,
        traces: [
          {
            test: '[chromium] › cart.spec.ts › totals',
            attempt: 0,
            status: 'failed',
            trace: '7f-0.zip',
          },
          {
            test: '[chromium] › cart.spec.ts › totals',
            attempt: 1,
            status: 'passed',
            trace: '7f-1.zip',
          },
          {
            test: '[chromium] › cart.spec.ts › subtotal',
            attempt: 0,
            status: 'passed',
            trace: '8a-0.zip',
          },
        ],
      },
    ],
  ]);

  const described = describeSurvivors(
    report({ id: '1', status: 'Survived', replacement: 'a < b' }),
    folders,
  );

  assert.equal(
    described.files['src/price-tag.tsx']?.mutants[0]?.description,
    [
      'Traces of this mutant run:',
      '  [chromium] › cart.spec.ts › totals (failed):',
      `    npx playwright show-trace "${path.join(dir, '7f-0.zip')}"`,
      '  [chromium] › cart.spec.ts › totals (retry 1, passed):',
      `    npx playwright show-trace "${path.join(dir, '7f-1.zip')}"`,
      '  [chromium] › cart.spec.ts › subtotal (passed):',
      `    npx playwright show-trace "${path.join(dir, '8a-0.zip')}"`,
      'Recheck this mutant after a test change:',
      '  npx stryker run "stryker.config.ts" --mutate "src/price-tag.tsx:9:6-9:29"',
    ].join('\n'),
  );
});

test('trace folders are read back by the key the report uses, from what the runner wrote', (t) => {
  const project = tempTree(t, 'lz-traces-index-', { 'trace.zip': '' });
  const tracesDir = path.join(project, 'traces');
  const dir = copySurvivorTraces(
    { dir: tracesDir, projectRoot: project },
    {
      fileName: path.join(project, 'src', 'price-tag.tsx'),
      mutatorName: 'EqualityOperator',
      replacement: 'a < b',
      location: {
        start: { line: 8, column: 6 },
        end: { line: 8, column: 29 },
      },
    },
    [
      addAttempt(fakeTestCase('t1'), 'skipped', 'skipped'),
      addAttempt(fakeTestCase('t2'), 'expected', 'passed', [
        { name: 'trace', path: path.join(project, 'trace.zip') },
      ]),
    ],
  );
  fs.writeFileSync(path.join(tracesDir, 'index.html'), '');

  const { folders, unreadable } = readTraceFolders(tracesDir);

  assert.deepEqual(
    [...folders],
    [
      [
        'src/price-tag.tsx@9:7-9:30\nEqualityOperator: a < b',
        {
          dir,
          traces: [
            { test: '[e2e] › app.spec.ts › t1', attempt: 0, status: 'skipped' },
            {
              test: '[e2e] › app.spec.ts › t2',
              attempt: 0,
              status: 'passed',
              trace: 't2-0.zip',
            },
          ],
        },
      ],
    ],
  );
  assert.deepEqual(unreadable, []);
});

test('a trace folder without a valid mutant.json is reported, not trusted', (t) => {
  const broken = {
    'key-not-text': '{"key": 3, "tests": []}',
    'trace-not-text':
      '{"key": "k", "tests": [{"test": "t", "attempt": 0, "status": "passed", "trace": 3}]}',
    'attempt-not-number':
      '{"key": "k", "tests": [{"test": "t", "attempt": "0", "status": "passed"}]}',
    'test-not-text':
      '{"key": "k", "tests": [{"test": 1, "attempt": 0, "status": "passed"}]}',
    'status-not-text':
      '{"key": "k", "tests": [{"test": "t", "attempt": 0, "status": null}]}',
    'tests-not-list': '{"key": "k", "tests": {}}',
    'not-json': '{',
  };
  const tracesDir = tempTree(
    t,
    'lz-traces-index-',
    Object.fromEntries(
      Object.entries(broken).map(([name, json]) => [
        path.join(name, mutantFile),
        json,
      ]),
    ),
  );
  fs.mkdirSync(path.join(tracesDir, 'no-mutant-json'));

  const { folders, unreadable } = readTraceFolders(tracesDir);

  assert.equal(folders.size, 0);
  assert.deepEqual(
    [...unreadable].sort(),
    [...Object.keys(broken), 'no-mutant-json']
      .sort()
      .map((name) => path.join(tracesDir, name)),
  );
});

test('a survivor lists a test that recorded no trace', () => {
  const folders = new Map([
    [
      'src/price-tag.tsx@9:7-9:30\nEqualityOperator: a < b',
      {
        dir: 'traces',
        traces: [
          {
            test: '[chromium] › cart.spec.ts › totals',
            attempt: 0,
            status: 'skipped',
            trace: undefined,
          },
        ],
      },
    ],
  ]);

  const described = describeSurvivors(
    report({ id: '1', status: 'Survived', replacement: 'a < b' }),
    folders,
  );

  assert.equal(
    described.files['src/price-tag.tsx']?.mutants[0]?.description,
    [
      'Traces of this mutant run:',
      '  [chromium] › cart.spec.ts › totals (skipped):',
      '    no trace recorded',
      'Recheck this mutant after a test change:',
      '  npx stryker run "stryker.config.ts" --mutate "src/price-tag.tsx:9:6-9:29"',
    ].join('\n'),
  );
});

test('the recheck command names no config file when the report has none', () => {
  const described = describeSurvivors(
    {
      ...report({ id: '1', status: 'Survived', replacement: 'a < b' }),
      config: {},
    },
    new Map(),
  );

  assert.equal(
    described.files['src/price-tag.tsx']?.mutants[0]?.description
      ?.split('\n')
      .at(-1),
    '  npx stryker run --mutate "src/price-tag.tsx:9:6-9:29"',
  );
});

test("the index page is Stryker's report app with the traced-run title, and the report cannot close its script tag", () => {
  const html = indexHtml(
    report({ id: '1', status: 'Survived', replacement: '"</script><b>"' }),
    'customElements.define("mutation-test-report-app", class extends HTMLElement {});',
  );

  assert.match(
    html,
    /<mutation-test-report-app title-postfix="Stryker, traced run">/,
  );
  assert.match(html, /customElements\.define\("mutation-test-report-app"/);
  assert.equal(html.match(/<\/script>/g)?.length, 2);
  assert.ok(html.includes('"\\"\\u003c/script\\u003e\\u003cb\\u003e\\""'));
  assert.ok(!html.includes('\u003c/script\u003e\u003cb\u003e'));
});
