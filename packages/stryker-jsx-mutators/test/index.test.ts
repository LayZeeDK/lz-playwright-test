// The entry module, each case in a child `node` process with an explicit env, so module state and
// STRYKER_MUTATOR_WORKER are fresh and this file also runs inside a Stryker worker.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { mutatorNames } from './support/installed.ts';

const entryPath = join(import.meta.dirname, 'fixture', 'entry.ts');

function runEntry(
  extraEnv: Readonly<Record<string, string>>,
  ...args: string[]
) {
  const env = { ...process.env };
  delete env['STRYKER_MUTATOR_WORKER'];
  const child = spawnSync(process.execPath, [entryPath, ...args], {
    encoding: 'utf8',
    env: { ...env, ...extraEnv },
  });

  return { status: child.status, stdout: child.stdout, stderr: child.stderr };
}

describe('index.ts', () => {
  it('registers every mutator of the table, wraps the placer, and exports an ignorer that ignores nothing', () => {
    const { status, stdout, stderr } = runEntry({});

    assert.equal(status, 0, stderr);
    assert.deepEqual(JSON.parse(stdout), {
      registered: mutatorNames,
      placerWrapped: true,
      ignorer: 'Ignore lz-jsx undefined',
    });
  });

  it("installs nothing in a worker, and the ignorer factory throws 'install did not run'", () => {
    const { status, stdout, stderr } = runEntry({
      STRYKER_MUTATOR_WORKER: '1',
    });

    assert.equal(status, 0, stderr);
    assert.deepEqual(JSON.parse(stdout), {
      registered: [],
      placerWrapped: false,
      ignorer:
        'throws @layzee/stryker-jsx-mutators: the install did not run, because STRYKER_MUTATOR_WORKER is set in a process ' +
        'that instruments. Unset it for the Stryker run.',
    });
  });

  it("rejects its import with install's error when another mutator already has one of this package's mutator names", () => {
    const { status, stdout, stderr } = runEntry({}, 'taken');

    assert.notEqual(status, 0);
    assert.equal(stdout, '');
    assert.match(
      stderr,
      /@layzee\/stryker-jsx-mutators: another mutator already has the name LzJsxTextLiteral\./,
    );
  });
});
