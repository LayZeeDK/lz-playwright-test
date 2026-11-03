import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import type { schema } from '@stryker-mutator/api/core';

import type { ReportedTest } from '../src/reporter.ts';
import { copySurvivorTraces } from '../src/survivor-traces.ts';
import {
  describeSurvivors,
  indexHtml,
  readTraceFolders,
} from '../src/traces-index.ts';

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

const untracedTest: ReportedTest = {
  id: 't1',
  expectedStatus: 'skipped',
  location: { file: 'cart.spec.ts', line: 1, column: 1 },
  parent: undefined,
  titlePath: () => ['', 'chromium', 'cart.spec.ts', 'totals'],
  outcome: () => 'skipped',
  results: [{ status: 'skipped', duration: 0, attachments: [] }],
};

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
      'No trace from this run: incremental mode reused this result. Recheck it to record one.',
      'Recheck this mutant after a test change:',
      '  npx stryker run stryker.config.ts --mutate "src/price-tag.tsx:9:7-9:30"',
    ].join('\n'),
  );
  assert.deepEqual(other, {
    mutatorName: 'EqualityOperator',
    location,
    ...killed,
  });
});

test('a survivor with a trace folder lists one show-trace command per trace and its recheck command', () => {
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
            test: 'chromium › cart.spec.ts › totals',
            attempt: 0,
            status: 'passed',
            trace: '7f-0.zip',
          },
          {
            test: 'chromium › cart.spec.ts › subtotal',
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
      '  chromium › cart.spec.ts › totals (passed):',
      `    npx playwright show-trace "${path.join(dir, '7f-0.zip')}"`,
      '  chromium › cart.spec.ts › subtotal (passed):',
      `    npx playwright show-trace "${path.join(dir, '8a-0.zip')}"`,
      'Recheck this mutant after a test change:',
      '  npx stryker run stryker.config.ts --mutate "src/price-tag.tsx:9:7-9:30"',
    ].join('\n'),
  );
});

test('trace folders are read back by key from what the runner wrote, and a folder without a valid mutant.json is reported, not trusted', () => {
  const tracesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lz-traces-index-'));

  try {
    const zip = path.join(tracesDir, 'trace.zip');
    fs.writeFileSync(zip, '');
    const tracedTest: ReportedTest = {
      ...untracedTest,
      id: 't2',
      titlePath: () => ['', 'chromium', 'cart.spec.ts', 'subtotal'],
      results: [
        {
          status: 'passed',
          duration: 1,
          attachments: [{ name: 'trace', path: zip }],
        },
      ],
    };
    const dir = copySurvivorTraces(
      tracesDir,
      {
        fileName: 'unused',
        mutatorName: 'EqualityOperator',
        replacement: 'a < b',
        location: {
          start: { line: 8, column: 6 },
          end: { line: 8, column: 29 },
        },
      },
      'src/price-tag.tsx',
      [untracedTest, tracedTest],
    );
    const broken = (name: string, json: string) => {
      fs.mkdirSync(path.join(tracesDir, name));
      fs.writeFileSync(path.join(tracesDir, name, 'mutant.json'), json);
    };
    broken('key-not-text', '{"key": 3, "tests": []}');
    broken(
      'trace-not-text',
      '{"key": "k", "tests": [{"test": "t", "attempt": 0, "status": "passed", "trace": 3}]}',
    );
    broken(
      'attempt-not-number',
      '{"key": "k", "tests": [{"test": "t", "attempt": "0", "status": "passed"}]}',
    );
    broken(
      'test-not-text',
      '{"key": "k", "tests": [{"test": 1, "attempt": 0, "status": "passed"}]}',
    );
    broken(
      'status-not-text',
      '{"key": "k", "tests": [{"test": "t", "attempt": 0, "status": null}]}',
    );
    broken('not-json', '{');
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
              {
                test: 'chromium › cart.spec.ts › totals',
                attempt: 0,
                status: 'skipped',
              },
              {
                test: 'chromium › cart.spec.ts › subtotal',
                attempt: 0,
                status: 'passed',
                trace: 't2-0.zip',
              },
            ],
          },
        ],
      ],
    );
    assert.deepEqual(
      [...unreadable].sort(),
      [
        'attempt-not-number',
        'key-not-text',
        'not-json',
        'status-not-text',
        'test-not-text',
        'trace-not-text',
      ].map((name) => path.join(tracesDir, name)),
    );
  } finally {
    fs.rmSync(tracesDir, { recursive: true, force: true });
  }
});

test('a survivor lists a test that recorded no trace, and its recheck command names no config file when the report has none', () => {
  const folders = new Map([
    [
      'src/price-tag.tsx@9:7-9:30\nEqualityOperator: a < b',
      {
        dir: 'traces',
        traces: [
          {
            test: 'chromium › cart.spec.ts › totals',
            attempt: 0,
            status: 'skipped',
            trace: undefined,
          },
        ],
      },
    ],
  ]);

  const described = describeSurvivors(
    {
      ...report({ id: '1', status: 'Survived', replacement: 'a < b' }),
      config: {},
    },
    folders,
  );

  assert.equal(
    described.files['src/price-tag.tsx']?.mutants[0]?.description,
    [
      'Traces of this mutant run:',
      '  chromium › cart.spec.ts › totals (skipped):',
      '    no trace recorded',
      'Recheck this mutant after a test change:',
      '  npx stryker run --mutate "src/price-tag.tsx:9:7-9:30"',
    ].join('\n'),
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
