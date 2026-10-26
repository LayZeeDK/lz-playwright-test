import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { INSTRUMENTER_CONSTANTS } from '@stryker-mutator/api/core';

import { RUN_SETTINGS } from '../src/protocol.ts';
import { type NodeNamespace, recordNodeCoverage } from '../src/worker-hook.ts';

// Records a worker's namespace with fake I/O; `exit()` runs what the worker does at process exit.
function worker(
  settings: { perTest: boolean; hitLimit?: number },
  testId?: () => string | undefined,
) {
  const ns: NodeNamespace = {};
  const lines: string[] = [];
  const listeners: (() => void)[] = [];
  recordNodeCoverage(
    ns,
    settings,
    testId ?? (() => undefined),
    (line) => lines.push(line),
    (listener) => listeners.push(listener),
  );

  return {
    ns,
    lines,
    exit: () => listeners.forEach((listener) => listener()),
  };
}

test('a Playwright worker outside a Stryker run loads the hook and installs nothing', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'worker-hook-test-'));

  try {
    // A path that ends like Playwright's worker entry, so only the run-settings check keeps the hook out.
    const entry = path.join(dir, 'playwright/lib/worker/workerProcessEntry.js');
    mkdirSync(path.dirname(entry), { recursive: true });
    writeFileSync(
      entry,
      `console.log(JSON.stringify(globalThis[${JSON.stringify(INSTRUMENTER_CONSTANTS.NAMESPACE)}] ?? null));`,
    );

    const child = spawnSync(
      process.execPath,
      [
        '--import',
        new URL('../src/worker-hook.ts', import.meta.url).href,
        entry,
      ],
      {
        encoding: 'utf8',
        env: { ...process.env, [RUN_SETTINGS]: undefined },
      },
    );

    assert.equal(child.status, 0, child.stderr);
    assert.equal(child.stdout.trim(), 'null');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a worker that ran no instrumented code writes nothing at exit', () => {
  const { lines, exit } = worker({ perTest: true });

  exit();

  assert.deepEqual(lines, []);
});

test('a worker writes the coverage its app code recorded at exit, as one line', () => {
  const { ns, lines, exit } = worker({ perTest: false });
  ns.mutantCoverage = { static: { '1': 2 }, perTest: {} };

  exit();

  assert.deepEqual(
    lines.map((line) => JSON.parse(line)),
    [
      {
        mutantCoverage: { static: { '1': 2 }, perTest: {} },
        outlivedItsTest: false,
      },
    ],
  );
});

test('the active mutant is left for the instrumented code to read from the environment', () => {
  const { ns } = worker({ perTest: true, hitLimit: 10 });

  assert.equal(ns.activeMutant, undefined);
  assert.equal(Object.hasOwn(ns, 'activeMutant'), false);
});

test('per-test coverage names the test running at the time, and none between tests', () => {
  let running: string | undefined = 'test-a';
  const { ns } = worker({ perTest: true }, () => running);

  assert.equal(ns.currentTestId, 'test-a');

  running = undefined;

  assert.equal(ns.currentTestId, undefined);
});

test('without per-test coverage no test id is set', () => {
  const { ns } = worker({ perTest: false }, () => 'test-a');

  assert.equal(ns.currentTestId, undefined);
});

test('with a hit limit the worker counts hits from zero and writes the count at exit', () => {
  const { ns, lines, exit } = worker({ perTest: false, hitLimit: 10 });

  assert.equal(ns.hitLimit, 10);
  assert.equal(ns.hitCount, 0);

  ns.hitCount = 4;
  exit();

  assert.deepEqual(
    lines.map((line) => JSON.parse(line)),
    [{ hitCount: 4, outlivedItsTest: false }],
  );
});

test('a worker past its hit limit writes its count at once, and not again at exit', () => {
  const { ns, lines, exit } = worker({ perTest: false, hitLimit: 10 });

  ns.hitCount = 10;

  assert.deepEqual(lines, []);

  ns.hitCount = 11;

  assert.deepEqual(
    lines.map((line) => JSON.parse(line)),
    [{ hitCount: 11, outlivedItsTest: false }],
  );

  ns.hitCount = 12;
  exit();

  assert.equal(lines.length, 1);
});

test('a write that fails at exit does not throw out of the exit listener', () => {
  const ns: NodeNamespace = {};
  const listeners: (() => void)[] = [];
  recordNodeCoverage(
    ns,
    { perTest: false },
    () => undefined,
    () => {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    },
    (listener) => listeners.push(listener),
  );
  ns.mutantCoverage = { static: { '1': 1 }, perTest: {} };

  assert.doesNotThrow(() => listeners.forEach((listener) => listener()));
});

test('without a hit limit the worker counts no hits', () => {
  const { ns } = worker({ perTest: true });

  assert.equal(ns.hitCount, undefined);
  assert.equal(ns.hitLimit, undefined);
});
