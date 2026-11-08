// Own file: node runs each test file in its own process, so the instrumenter's allMutators list is pristine here.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { builtInNames, builtInSample } from '../src/built-ins.ts';
import { corePackageJson, resolveInstrumenter } from '../src/instrumenter.ts';

function acceptTypes(value: unknown): asserts value is unknown {
  void value;
}

describe('builtInSample', () => {
  it('makes a mutant of each of the 17 built-ins before any is removed, so the check that none remains can fail', async () => {
    const instrumenter = await resolveInstrumenter(
      '@layzee/stryker-mutator-install',
      acceptTypes,
      corePackageJson(),
    );

    const mutants = await instrumenter.instrument([
      { name: 'built-ins.self-check.tsx', content: builtInSample },
    ]);

    assert.deepEqual(
      builtInNames.filter(
        (name) => !mutants.some(({ mutatorName }) => mutatorName === name),
      ),
      [],
    );
  });
});
