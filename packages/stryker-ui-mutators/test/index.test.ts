// The entry module, each case in a child `node` process with an explicit env, so module state and
// STRYKER_MUTATOR_WORKER are fresh and this file also runs inside a Stryker worker.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { operatorNames } from '../src/operators.ts';

const ENTRY = join(import.meta.dirname, 'fixture', 'entry.ts');

function runEntry(worker: boolean, ...args: string[]) {
  const { STRYKER_MUTATOR_WORKER: _ignored, ...env } = process.env;
  const child = spawnSync(process.execPath, [ENTRY, ...args], {
    encoding: 'utf8',
    env: worker ? { ...env, STRYKER_MUTATOR_WORKER: '1' } : env,
  });

  return { status: child.status, stdout: child.stdout, stderr: child.stderr };
}

describe('index.ts', () => {
  it('registers every operator of the table, wraps the placer, and exports an ignorer that ignores nothing', () => {
    const { status, stdout, stderr } = runEntry(false);

    assert.equal(status, 0, stderr);
    assert.deepEqual(JSON.parse(stdout), { registered: operatorNames, placerWrapped: true, ignorer: 'Ignore ui-mutators undefined' });
  });

  it("installs nothing in a worker, and the ignorer factory throws 'install did not run'", () => {
    const { status, stdout, stderr } = runEntry(true);

    assert.equal(status, 0, stderr);
    assert.deepEqual(JSON.parse(stdout), {
      registered: [],
      placerWrapped: false,
      ignorer:
        'throws stryker-ui-mutators: the install did not run, because STRYKER_MUTATOR_WORKER is set in a process ' +
        'that instruments. Unset it for the Stryker run.',
    });
  });

  it("rejects its import with the operator's name when an operator's sample gives no mutant", () => {
    const { status, stdout, stderr } = runEntry(false, 'broken');

    assert.notEqual(status, 0);
    assert.equal(stdout, '');
    assert.match(stderr, /stryker-ui-mutators: the instrumenter 10\.1\.1 in .+ made no mutants of TextLiteral from their samples/);
  });
});
