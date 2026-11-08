import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { selectMutators, type MutatorSets } from '../src/select.ts';

const packageName = '@layzee/test-mutators';
const installName = 'lzTestMutators';
const named = (name: string) => ({ name });
const sets: MutatorSets<{ readonly name: string }> = {
  defaults: [named('LzDefaultA'), named('LzDefaultB')],
  optIn: [named('LzOptInA'), named('LzOptInB')],
  experimental: [named('LzExperimentalA'), named('LzExperimentalB')],
};
const select = (options: unknown) =>
  selectMutators(packageName, installName, sets, options);

describe('selectMutators', () => {
  it('selects the defaults when there are no options', () => {
    assert.deepEqual(select(undefined), sets.defaults);
  });

  describe('when the package has no opt-in or experimental mutators', () => {
    const defaultsOnly = { ...sets, optIn: [], experimental: [] };
    const noOptions =
      '@layzee/test-mutators: the package has no opt-in or experimental mutators yet, so lzTestMutators() takes ' +
      'no options. Turn a mutator off with mutator.excludedMutations.';

    it('rejects an options key', () => {
      assert.throws(
        () =>
          selectMutators(packageName, installName, defaultsOnly, {
            extended: true,
          }),
        { message: noOptions },
      );
    });

    it('treats an options key that holds undefined as absent', () => {
      assert.deepEqual(
        selectMutators(packageName, installName, defaultsOnly, {
          extended: undefined,
        }),
        sets.defaults,
      );
    });
  });
});
