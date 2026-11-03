import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { isRecord } from '../src/is-record.ts';
import type { ReportedTest } from '../src/reporter.ts';
import {
  cleanTracesDir,
  copySurvivorTraces,
  folderName,
  mutantKey,
  projectRootEnv,
  readTracesTarget,
  reportFileName,
  tracesDirEnv,
} from '../src/survivor-traces.ts';

const location = {
  start: { line: 8, column: 6 },
  end: { line: 8, column: 29 },
};
const mutant = (replacement: string) => ({
  fileName: 'unused',
  mutatorName: 'EqualityOperator',
  replacement,
  location,
});

test('the key uses the report positions, and folder names keep apart mutants that differ only in operators', () => {
  const less = mutantKey(mutant('compareAtCents < cents'), 'src/price-tag.tsx');
  const more = mutantKey(mutant('compareAtCents > cents'), 'src/price-tag.tsx');

  assert.equal(
    less,
    'src/price-tag.tsx@9:7-9:30\nEqualityOperator: compareAtCents < cents',
  );
  assert.notEqual(folderName(less), folderName(more));
  assert.match(
    folderName(less),
    /^src-price-tag-tsx-9-7-9-30-EqualityOperator-compareAtCents-cents-[0-9a-f]{8}$/,
  );
  assert.match(folderName('x'.repeat(91)), /^x{91}-[0-9a-f]{8}$/);
  assert.match(
    folderName('a'.repeat(300) + 'b'.repeat(300)),
    /^a{45}-b{45}-[0-9a-f]{8}$/,
  );
  assert.match(folderName('a\u0000b<>c_d.é'), /^a-b-c-d-é-[0-9a-f]{8}$/);
});

function reportedTest(
  id: string,
  attempts: { status: 'passed' | 'failed'; trace?: string }[],
): ReportedTest {
  return {
    id,
    expectedStatus: 'passed',
    location: { file: 'a.spec.ts', line: 1, column: 1 },
    parent: undefined,
    titlePath: () => ['', 'chromium', 'a.spec.ts', `test ${id}`],
    outcome: () => 'expected',
    results: attempts.map(({ status, trace }) => ({
      status,
      duration: 1,
      attachments: [
        { name: 'screenshot', path: 'missing.png' },
        { name: 'trace' },
        ...(trace ? [{ name: 'trace', path: trace }] : []),
      ],
    })),
  };
}

test('a survivor gets one trace per attempt of every test that ran, and a mutant.json with each status', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lz-traces-test-'));

  try {
    const traces = path.join(tmp, 'reports', 'traces');
    const first = path.join(tmp, 'first.zip');
    const retry = path.join(tmp, 'retry.zip');
    fs.writeFileSync(first, 'one');
    fs.writeFileSync(retry, 'two');

    const dir = copySurvivorTraces(traces, mutant('a > b'), 'src/a.ts', [
      reportedTest('t1', [
        { status: 'failed', trace: first },
        { status: 'passed', trace: retry },
      ]),
      reportedTest('t2', [{ status: 'passed' }]),
    ]);
    const written: unknown = JSON.parse(
      fs.readFileSync(path.join(dir, 'mutant.json'), 'utf8'),
    );

    assert.deepEqual(fs.readdirSync(dir).sort(), [
      'mutant.json',
      't1-0.zip',
      't1-1.zip',
    ]);
    assert.equal(fs.readFileSync(path.join(dir, 't1-1.zip'), 'utf8'), 'two');
    assert.ok(isRecord(written));
    assert.deepEqual(written['tests'], [
      {
        test: 'chromium › a.spec.ts › test t1',
        attempt: 0,
        status: 'failed',
        trace: 't1-0.zip',
      },
      {
        test: 'chromium › a.spec.ts › test t1',
        attempt: 1,
        status: 'passed',
        trace: 't1-1.zip',
      },
      { test: 'chromium › a.spec.ts › test t2', attempt: 0, status: 'passed' },
    ]);

    cleanTracesDir(traces);
    assert.deepEqual(fs.readdirSync(traces), []);
    const fresh = path.join(tmp, 'new', 'reports', 'traces');
    cleanTracesDir(fresh);
    assert.deepEqual(fs.readdirSync(fresh), []);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('the runner names files relative to the project root the reporter passed, not to its sandbox', () => {
  const env = {
    [tracesDirEnv]: 'D:/p/reports/traces',
    [projectRootEnv]: 'D:/p',
  };

  assert.deepEqual(readTracesTarget('reports/traces', env), {
    dir: 'D:/p/reports/traces',
    projectRoot: 'D:/p',
  });
  assert.equal(
    reportFileName('D:/p/apps/demo/src/app.tsx', 'D:/p'),
    'apps/demo/src/app.tsx',
  );
  assert.equal(readTracesTarget(undefined, env), undefined);
  assert.throws(
    () => readTracesTarget('reports/traces', {}),
    /lz-playwright-traces reporter is not in reporters\. Add it: it empties the traces folder/,
  );
});
