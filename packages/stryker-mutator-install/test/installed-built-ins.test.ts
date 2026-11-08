// Own file: node runs each test file in its own process, so the instrumenter's allMutators list is pristine here.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { builtInNames } from '../src/built-ins.ts';
import { corePackageJson, resolveInstrumenter } from '../src/instrumenter.ts';

function acceptTypes(value: unknown): asserts value is unknown {
  void value;
}

describe('builtInNames', () => {
  it('equals the built-in mutator names of the installed Stryker, so a Stryker upgrade that adds, renames or drops one fails here', async () => {
    const instrumenter = await resolveInstrumenter(
      '@layzee/stryker-mutator-install',
      acceptTypes,
      corePackageJson(),
    );

    assert.deepEqual(
      instrumenter.allMutators.map(({ name }) => name).sort(),
      [...builtInNames].sort(),
    );
  });
});
