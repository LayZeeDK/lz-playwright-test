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

  it('adds every opt-in mutator with extended, in roster order', () => {
    assert.deepEqual(select({ extended: true }), [
      ...sets.defaults,
      ...sets.optIn,
    ]);
  });

  it('adds an opt-in mutator turned on by its name', () => {
    assert.deepEqual(select({ LzOptInB: true }), [
      ...sets.defaults,
      named('LzOptInB'),
    ]);
  });

  it('rejects a value other than true', () => {
    assert.throws(() => select({ LzOptInA: false }), {
      message:
        "@layzee/test-mutators: LzOptInA takes only true, not false; Stryker's mutator.excludedMutations turns " +
        'mutators off.',
    });
  });

  it('rejects an unknown name, listing the opt-in names', () => {
    assert.throws(() => select({ LzOptInC: true }), {
      message:
        '@layzee/test-mutators: no opt-in mutator is named LzOptInC; the names are LzOptInA, LzOptInB.',
    });
  });

  it("rejects a default mutator's name, as it runs by default", () => {
    assert.throws(() => select({ LzDefaultA: true }), {
      message:
        '@layzee/test-mutators: no opt-in mutator is named LzDefaultA; it runs by default.',
    });
  });

  it('adds every experimental mutator with experimental: true', () => {
    assert.deepEqual(select({ experimental: true }), [
      ...sets.defaults,
      ...sets.experimental,
    ]);
  });

  it('adds an experimental mutator turned on by its name inside experimental', () => {
    assert.deepEqual(select({ experimental: { LzExperimentalB: true } }), [
      ...sets.defaults,
      named('LzExperimentalB'),
    ]);
  });

  it('rejects an experimental name outside experimental', () => {
    assert.throws(() => select({ LzExperimentalA: true }), {
      message:
        '@layzee/test-mutators: no opt-in mutator is named LzExperimentalA; it is experimental, so it goes inside ' +
        'experimental.',
    });
  });

  it('rejects an opt-in name inside experimental', () => {
    assert.throws(() => select({ experimental: { LzOptInA: true } }), {
      message:
        '@layzee/test-mutators: no experimental mutator is named LzOptInA; it is opt-in, so it goes outside ' +
        'experimental.',
    });
  });

  it('rejects an unknown name inside experimental, listing the experimental names', () => {
    assert.throws(() => select({ experimental: { LzExperimentalC: true } }), {
      message:
        '@layzee/test-mutators: no experimental mutator is named LzExperimentalC; the names are LzExperimentalA, ' +
        'LzExperimentalB.',
    });
  });

  it('rejects a value other than true inside experimental', () => {
    assert.throws(() => select({ experimental: { LzExperimentalA: 1 } }), {
      message:
        "@layzee/test-mutators: experimental.LzExperimentalA takes only true, not 1; Stryker's " +
        'mutator.excludedMutations turns mutators off.',
    });
  });

  it('rejects experimental when the package has no experimental mutators', () => {
    assert.throws(
      () =>
        selectMutators(
          packageName,
          installName,
          { ...sets, experimental: [] },
          { experimental: true },
        ),
      {
        message:
          '@layzee/test-mutators: the package has no experimental mutators yet, so lzTestMutators() takes no ' +
          'experimental option.',
      },
    );
  });

  it('rejects extended when the package has no opt-in mutators', () => {
    assert.throws(
      () =>
        selectMutators(
          packageName,
          installName,
          { ...sets, optIn: [] },
          { extended: true },
        ),
      {
        message:
          '@layzee/test-mutators: the package has no opt-in mutators yet, so lzTestMutators() takes no ' +
          'extended option.',
      },
    );
  });

  it('rejects options that are not an object', () => {
    assert.throws(() => select('extended'), {
      message:
        "@layzee/test-mutators: the options must be an object, not 'extended'.",
    });
  });

  it('lists none when an opt-in name is given and the package has no opt-in mutators', () => {
    assert.throws(
      () =>
        selectMutators(
          packageName,
          installName,
          { ...sets, optIn: [] },
          { LzOptInA: true },
        ),
      {
        message:
          '@layzee/test-mutators: no opt-in mutator is named LzOptInA; the names are none.',
      },
    );
  });

  it('rejects an array as the options', () => {
    assert.throws(() => select(['extended']), {
      message:
        "@layzee/test-mutators: the options must be an object, not [ 'extended' ].",
    });
    assert.throws(() => select([]), {
      message: '@layzee/test-mutators: the options must be an object, not [].',
    });
  });

  it('selects an opt-in name when the package has no experimental mutators', () => {
    assert.deepEqual(
      selectMutators(
        packageName,
        installName,
        { ...sets, experimental: [] },
        { LzOptInA: true },
      ),
      [...sets.defaults, sets.optIn[0]],
    );
  });

  it('rejects an object as the value of an opt-in name', () => {
    assert.throws(() => select({ LzOptInA: { LzExperimentalA: true } }), {
      message:
        "@layzee/test-mutators: LzOptInA takes only true, not { LzExperimentalA: true }; Stryker's " +
        'mutator.excludedMutations turns mutators off.',
    });
  });

  it('rejects false as the value of experimental', () => {
    assert.throws(() => select({ experimental: false }), {
      message:
        "@layzee/test-mutators: experimental takes only true, not false; Stryker's " +
        'mutator.excludedMutations turns mutators off.',
    });
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

    it('selects the defaults when there are no options', () => {
      assert.deepEqual(
        selectMutators(packageName, installName, defaultsOnly, undefined),
        sets.defaults,
      );
    });

    it('rejects an options key next to one that holds undefined', () => {
      assert.throws(
        () =>
          selectMutators(packageName, installName, defaultsOnly, {
            extended: undefined,
            LzOptInA: true,
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
