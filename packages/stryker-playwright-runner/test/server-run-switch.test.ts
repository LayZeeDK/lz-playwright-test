import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { type TestContext, test } from 'node:test';

import type { StrykerNamespace } from '../src/namespace.ts';
import { readSnapshotDir, snapshotSuffix } from '../src/protocol.ts';
import { mergeCoverage } from '../src/run-result.ts';
import {
  controlFile,
  type ServerControl,
  serverSnapshotPrefix,
  writeServerControl,
} from '../src/server-protocol.ts';
import { runSwitch } from '../src/server-run-switch.ts';
import { tempTree, withoutPrototypes } from './support/doubles.ts';

function switched(t: TestContext) {
  const dir = tempTree(t, 'server-run-switch-');
  const namespace: StrykerNamespace = {};
  const run = runSwitch(
    dir,
    namespace,
    `${serverSnapshotPrefix}1-x${snapshotSuffix}`,
  );
  let runs = 0;

  return {
    dir,
    namespace,
    run,
    write(control: Omit<ServerControl, 'outDir'>) {
      const outDir = path.join(dir, 'runs', String(runs++));
      mkdirSync(outDir, { recursive: true });
      writeServerControl(dir, { outDir, ...control });

      return outDir;
    },
  };
}

function hitsOf(outDir: string): number {
  return readSnapshotDir(outDir).snapshots.reduce(
    (sum, { hitCount }) => sum + hitCount,
    0,
  );
}

test('a request activates the mutant of the control file, and none before there is one', (t) => {
  const { namespace, run, write } = switched(t);

  run.startRequest();

  assert.equal(namespace.activeMutant, undefined);
  assert.equal(run.control(), undefined);

  write({ perTest: false, activeMutant: '2' });
  run.startRequest();

  assert.equal(namespace.activeMutant, '2');

  write({ perTest: false });
  run.startRequest();

  assert.equal(namespace.activeMutant, undefined);
});

test('a control file that is gone leaves no control, not the previous run', (t) => {
  const { dir, namespace, run, write } = switched(t);
  write({ perTest: false, activeMutant: '2' });
  run.startRequest();
  rmSync(path.join(dir, controlFile));
  run.startRequest();

  assert.equal(run.control(), undefined);
  assert.equal(namespace.activeMutant, undefined);
});

test('a control file that cannot be read keeps the previous control, and warns once', (t) => {
  const { dir, namespace, run, write } = switched(t);
  const emitWarning = t.mock.method(process, 'emitWarning', () => undefined);
  write({ perTest: false, activeMutant: '2' });
  run.startRequest();
  rmSync(path.join(dir, controlFile));
  mkdirSync(path.join(dir, controlFile));
  run.startRequest();
  run.startRequest();

  assert.equal(namespace.activeMutant, '2');
  assert.equal(run.control()?.activeMutant, '2');
  assert.equal(emitWarning.mock.callCount(), 1);
  assert.match(
    String(emitWarning.mock.calls[0]?.arguments[0]),
    /control\.json/,
  );
});

test('an invalid control file leaves no control, not the previous run, and warns once', (t) => {
  const { dir, namespace, run, write } = switched(t);
  const emitWarning = t.mock.method(process, 'emitWarning', () => undefined);
  write({ perTest: false, activeMutant: '2' });
  run.startRequest();
  writeFileSync(path.join(dir, controlFile), '{"outDir":');
  run.startRequest();
  run.startRequest();

  assert.equal(run.control(), undefined);
  assert.equal(namespace.activeMutant, undefined);
  assert.equal(emitWarning.mock.callCount(), 1);
  assert.match(
    String(emitWarning.mock.calls[0]?.arguments[0]),
    /control\.json/,
  );
});

test("a run's hit count counts only the hits in that run", (t) => {
  const { namespace, run, write } = switched(t);
  const first = write({ perTest: false, activeMutant: '7', hitLimit: 10 });
  run.startRequest();

  assert.equal(namespace.hitLimit, 10);
  assert.equal(namespace.hitCount, 0);

  namespace.hitCount = 1;
  run.flush();
  run.startRequest();
  namespace.hitCount = 2;
  run.flush();
  const second = write({ perTest: false, activeMutant: '7', hitLimit: 10 });
  run.startRequest();
  namespace.hitCount = 1;
  run.flush();

  assert.equal(hitsOf(first), 2);
  assert.equal(hitsOf(second), 1);
});

test('coverage before the first run goes to the first run, and each run gets only its own hits', (t) => {
  const { namespace, run, write } = switched(t);
  const coverage: {
    readonly static: Record<string, number>;
    readonly perTest: Record<string, Record<string, number>>;
  } = { static: { '0': 1 }, perTest: {} };
  namespace.mutantCoverage = coverage;
  run.startRequest();
  run.flush();
  const first = write({ perTest: true });
  run.startRequest();
  coverage.perTest['small'] = { '7': 1 };
  run.flush();
  const second = write({ perTest: true });
  run.startRequest();
  coverage.perTest['small'] = { '7': 1 };
  run.flush();

  assert.deepEqual(
    withoutPrototypes(mergeCoverage(readSnapshotDir(first).snapshots)),
    { static: { '0': 1 }, perTest: { small: { '7': 1 } } },
  );
  assert.deepEqual(
    withoutPrototypes(mergeCoverage(readSnapshotDir(second).snapshots)),
    { static: {}, perTest: { small: { '7': 1 } } },
  );
});

test('a run folder that is gone drops the coverage without a throw', (t) => {
  const { dir, namespace, run } = switched(t);
  writeServerControl(dir, { outDir: path.join(dir, 'gone'), perTest: true });
  run.startRequest();
  namespace.mutantCoverage = { static: {}, perTest: { small: { '7': 1 } } };

  assert.doesNotThrow(() => run.flush());
});
