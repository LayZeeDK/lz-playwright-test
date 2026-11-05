// The entry module. The install cases each run in a child `node` process, so the instrumenter starts without this
// package's mutators.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { lzJsxMutators } from '../src/index.ts';
import { mutatorNames } from './support/installed.ts';

const entryPath = join(import.meta.dirname, 'fixture', 'entry.ts');
const noOptions =
  '@layzee/stryker-jsx-mutators: the package has no opt-in or experimental mutators yet, so lzJsxMutators() takes ' +
  'no options. Turn a mutator off with mutator.excludedMutations.';

function runEntry(mode: string) {
  const child = spawnSync(process.execPath, [entryPath, mode], {
    encoding: 'utf8',
  });

  return { status: child.status, stdout: child.stdout, stderr: child.stderr };
}

async function callWith(options: unknown): Promise<void> {
  await Reflect.apply(lzJsxMutators, undefined, [options]);
}

describe('index.ts', () => {
  it('installs nothing on import, and exports lz-jsx-styling and the options schema', () => {
    const { status, stdout, stderr } = runEntry('import');

    assert.equal(status, 0, stderr);
    assert.deepEqual(JSON.parse(stdout), {
      registered: [],
      placerWrapped: false,
      ignorers: ['Ignore lz-jsx-styling undefined'],
      schema: true,
    });
  });

  it('registers every mutator of the table and wraps the placer when lzJsxMutators() is awaited', () => {
    const { status, stdout, stderr } = runEntry('install');

    assert.equal(status, 0, stderr);
    assert.deepEqual(JSON.parse(stdout), {
      registered: mutatorNames,
      placerWrapped: true,
      ignorers: ['Ignore lz-jsx-styling undefined'],
      schema: true,
    });
  });

  it("rejects lzJsxMutators() with install's error when another mutator already has one of this package's mutator names", () => {
    const { status, stdout, stderr } = runEntry('taken');

    assert.notEqual(status, 0);
    assert.equal(stdout, '');
    assert.match(
      stderr,
      /@layzee\/stryker-jsx-mutators: another mutator already has the name LzJsxTextLiteral\./,
    );
  });

  it('rejects options that are not an object', async () => {
    await assert.rejects(callWith(true), { message: noOptions });
  });

  it('rejects an options array', async () => {
    await assert.rejects(callWith([]), { message: noOptions });
  });

  it('rejects an options key', async () => {
    await assert.rejects(callWith({ extended: true }), {
      message: noOptions,
    });
  });

  it('treats an options key that holds undefined as absent, and installs', () => {
    const { status, stdout, stderr } = runEntry('undefined-option');

    assert.equal(status, 0, stderr);
    assert.deepEqual(JSON.parse(stdout), {
      registered: mutatorNames,
      placerWrapped: true,
      ignorers: ['Ignore lz-jsx-styling undefined'],
      schema: true,
    });
  });
});
