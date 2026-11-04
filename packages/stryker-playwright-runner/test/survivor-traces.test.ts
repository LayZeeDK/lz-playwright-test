import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import {
  cleanTracesDir,
  copySurvivorTraces,
  folderName,
  mutantFile,
  mutantKey,
  projectRootEnv,
  readTracesTarget,
  reportFileName,
  tracesDirEnv,
} from '../src/survivor-traces.ts';
import { addAttempt, fakeTestCase, tempTree } from './support/doubles.ts';

const location = {
  start: { line: 8, column: 6 },
  end: { line: 8, column: 29 },
};
const mutant = (replacement: string, fileName = 'unused') => ({
  fileName,
  mutatorName: 'EqualityOperator',
  replacement,
  location,
});

test('a mutant key uses the report positions, which count lines and columns from 1', () => {
  assert.equal(
    mutantKey(mutant('compareAtCents < cents'), 'src/price-tag.tsx'),
    'src/price-tag.tsx@9:7-9:30\nEqualityOperator: compareAtCents < cents',
  );
});

test('folder names keep apart mutants that differ only in operators', () => {
  const less = mutantKey(mutant('compareAtCents < cents'), 'src/price-tag.tsx');
  const more = mutantKey(mutant('compareAtCents > cents'), 'src/price-tag.tsx');

  assert.notEqual(folderName(less), folderName(more));
  assert.match(
    folderName(less),
    /^src-price-tag-tsx-9-7-9-30-EqualityOperator-compareAtCents-cents-[0-9a-f]{8}$/,
  );
});

test('folder names trim long keys in the middle and replace unsafe characters', () => {
  assert.match(folderName('x'.repeat(91)), /^x{91}-[0-9a-f]{8}$/);
  assert.match(
    folderName('a'.repeat(300) + 'b'.repeat(300)),
    /^a{45}-b{45}-[0-9a-f]{8}$/,
  );
  assert.match(folderName('a\u0000b<>c_d.é'), /^a-b-c-d-é-[0-9a-f]{8}$/);
});

test('a survivor gets one trace per attempt of every test that ran, and a mutant.json with each status', (t) => {
  const tmp = tempTree(t, 'lz-traces-test-', {
    'first.zip': 'one',
    'retry.zip': 'two',
  });
  const traces = path.join(tmp, 'reports', 'traces');
  const trace = (file: string) => [
    { name: 'screenshot', path: 'missing.png' },
    { name: 'trace' },
    { name: 'trace', path: path.join(tmp, file) },
  ];
  const retried = addAttempt(
    addAttempt(fakeTestCase('t1'), 'flaky', 'failed', trace('first.zip')),
    'flaky',
    'passed',
    trace('retry.zip'),
  );
  const untraced = addAttempt(fakeTestCase('t2'), 'expected', 'passed');

  const dir = copySurvivorTraces(
    { dir: traces, projectRoot: tmp },
    mutant('a > b', path.join(tmp, 'src', 'a.ts')),
    [retried, untraced],
  );

  assert.equal(path.dirname(dir), traces);
  assert.deepEqual(fs.readdirSync(dir).sort(), [
    mutantFile,
    't1-0.zip',
    't1-1.zip',
  ]);
  assert.equal(fs.readFileSync(path.join(dir, 't1-1.zip'), 'utf8'), 'two');
  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(dir, mutantFile), 'utf8')),
    {
      key: 'src/a.ts@9:7-9:30\nEqualityOperator: a > b',
      tests: [
        {
          test: '[e2e] › app.spec.ts › t1',
          attempt: 0,
          status: 'failed',
          trace: 't1-0.zip',
        },
        {
          test: '[e2e] › app.spec.ts › t1',
          attempt: 1,
          status: 'passed',
          trace: 't1-1.zip',
        },
        { test: '[e2e] › app.spec.ts › t2', attempt: 0, status: 'passed' },
      ],
    },
  );
});

test('cleaning the traces folder empties it, or creates it when it is missing', (t) => {
  const tmp = tempTree(t, 'lz-traces-test-', {
    'traces/old/mutant.json': '{}',
  });
  const fresh = path.join(tmp, 'new', 'traces');

  cleanTracesDir(path.join(tmp, 'traces'));
  cleanTracesDir(fresh);

  assert.deepEqual(fs.readdirSync(path.join(tmp, 'traces')), []);
  assert.deepEqual(fs.readdirSync(fresh), []);
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
});

test('without survivorTraces the runner reads no target, and with it the reporter must have run', () => {
  assert.equal(readTracesTarget(undefined, {}), undefined);
  assert.throws(
    () => readTracesTarget('reports/traces', {}),
    /lz-playwright-traces reporter is not in reporters\. Add it: it empties the traces folder/,
  );
});
