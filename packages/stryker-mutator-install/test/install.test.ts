import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type {
  Instrumenter,
  ListedMutator,
  MutantOrigin,
  SourceFile,
} from '../src/instrumenter.ts';
import {
  checkNames,
  markOf,
  register,
  selfCheck,
  warnUntested,
} from '../src/install.ts';

const packageName = '@layzee/test-mutators';
const listed = (name: string): ListedMutator => ({
  name,
  mutate: () => undefined,
});
const named = (...names: string[]) => names.map((name) => ({ name }));

describe('markOf', () => {
  it('is the symbol registered under the package name', () => {
    assert.equal(markOf(packageName), Symbol.for(packageName));
  });
});

describe('checkNames', () => {
  it('accepts names of letters that no other mutator has', () => {
    assert.doesNotThrow(() =>
      checkNames(packageName, named('LzOne', 'LzTwo'), [listed('Regex')]),
    );
  });

  it('lists each name with another character than a letter, in order', () => {
    assert.throws(
      () =>
        checkNames(packageName, named('Text1', 'Good', 'Text-Literal', ''), []),
      {
        message:
          "@layzee/test-mutators: a mutator name has letters only, as Stryker's directives match no other " +
          'character: "Text1", "Text-Literal", ""',
      },
    );
  });

  it('rejects a name that another mutator has, ignoring case', () => {
    assert.throws(
      () => checkNames(packageName, named('LzOne', 'regex'), [listed('Regex')]),
      {
        message:
          '@layzee/test-mutators: another mutator already has the name regex.',
      },
    );
  });

  it('lists every taken name, in order', () => {
    assert.throws(
      () =>
        checkNames(packageName, named('Regex', 'Free', 'ObjectLiteral'), [
          listed('ObjectLiteral'),
          listed('Regex'),
        ]),
      {
        message:
          '@layzee/test-mutators: another mutator already has the name Regex, ObjectLiteral.',
      },
    );
  });

  it('rejects the second of two names that differ only in case', () => {
    assert.throws(() => checkNames(packageName, named('LzOne', 'lzone'), []), {
      message:
        '@layzee/test-mutators: another mutator already has the name lzone.',
    });
  });

  it('accepts a name that an entry of the package itself holds', () => {
    const own = { ...listed('LzOne'), [markOf(packageName)]: 1 };
    const foreign = {
      ...listed('LzTwo'),
      [markOf('@layzee/other-mutators')]: 1,
    };

    assert.doesNotThrow(() =>
      checkNames(packageName, named('LzOne'), [own, foreign]),
    );
    assert.throws(() =>
      checkNames(packageName, named('LzTwo'), [own, foreign]),
    );
  });
});

describe('register', () => {
  it('appends the missing mutators, marked as the package own, and keeps the rest', () => {
    const existing = listed('Regex');
    const allMutators: ListedMutator[] = [existing];
    const first = listed('LzOne');
    const second = listed('LzTwo');

    register(packageName, allMutators, [first, second]);

    const mark = markOf(packageName);

    assert.equal(allMutators.length, 3);
    assert.equal(allMutators[0], existing);
    assert.deepEqual(
      allMutators.slice(1).map(({ name }) => name),
      ['LzOne', 'LzTwo'],
    );
    assert.equal(allMutators[1]?.mutate, first.mutate);
    assert.equal(Reflect.get(allMutators[1] ?? {}, mark), mark);
    assert.equal(Reflect.get(allMutators[2] ?? {}, mark), mark);
    assert.equal(mark in existing, false);
  });

  it('skips a mutator whose name the list holds already', () => {
    const existing = listed('LzOne');
    const allMutators: ListedMutator[] = [existing];

    register(packageName, allMutators, [listed('LzOne'), listed('LzTwo')]);

    assert.deepEqual(
      allMutators.map(({ name }) => name),
      ['LzOne', 'LzTwo'],
    );
    assert.equal(allMutators[0], existing);
  });
});

describe('register converges', () => {
  it('replaces the entries of an earlier call with the new selection, in place, and keeps the siblings', () => {
    const builtIn = listed('Regex');
    const foreign = {
      ...listed('LzForeign'),
      [markOf('@layzee/other-mutators')]: 1,
    };
    const allMutators: ListedMutator[] = [builtIn];
    const list = allMutators;

    register(packageName, allMutators, [listed('LzOne'), listed('LzTwo')]);
    allMutators.splice(1, 0, foreign);
    register(packageName, allMutators, [listed('LzTwo'), listed('LzThree')]);

    assert.equal(allMutators, list);
    assert.deepEqual(
      allMutators.map(({ name }) => name),
      ['Regex', 'LzForeign', 'LzTwo', 'LzThree'],
    );
    assert.equal(allMutators[0], builtIn);
    assert.equal(allMutators[1], foreign);
  });
});

describe('selfCheck', () => {
  const fakeInstrumenter = (
    mutantsOf: (files: readonly SourceFile[]) => readonly MutantOrigin[],
    seen: SourceFile[] = [],
  ): Pick<Instrumenter<unknown>, 'dir' | 'instrument' | 'version'> => ({
    dir: '/fake/instrumenter',
    version: '1.2.3',
    instrument: async (files) => {
      seen.push(...files);

      return mutantsOf(files);
    },
  });
  const samples = [
    { name: 'LzOne', sample: 'one();' },
    { name: 'LzTwo', sample: 'two();' },
  ];

  it('passes when every mutator makes a mutant in its own sample file', async () => {
    const seen: SourceFile[] = [];
    const instrumenter = fakeInstrumenter(
      (files) =>
        files.map(({ name }) => ({
          fileName: name,
          mutatorName: name.replace('.self-check.tsx', ''),
        })),
      seen,
    );

    await selfCheck(packageName, instrumenter, samples);

    assert.deepEqual(seen, [
      { name: 'LzOne.self-check.tsx', content: 'one();' },
      { name: 'LzTwo.self-check.tsx', content: 'two();' },
    ]);
  });

  it('throws, listing the mutators that made no mutant', async () => {
    const instrumenter = fakeInstrumenter(() => [
      { fileName: 'LzOne.self-check.tsx', mutatorName: 'LzOne' },
      { fileName: 'LzTwo.self-check.tsx', mutatorName: 'Regex' },
      { fileName: 'Other.self-check.tsx', mutatorName: 'LzTwo' },
    ]);

    await assert.rejects(selfCheck(packageName, instrumenter, samples), {
      message:
        '@layzee/test-mutators: the instrumenter 1.2.3 in /fake/instrumenter made no mutants of LzTwo from their ' +
        'samples, so it does not run the mutators this module added. A bundled or second copy of the instrumenter ' +
        'does that.',
    });
  });

  it('lists every silent mutator, in order', async () => {
    const instrumenter = fakeInstrumenter(() => []);

    await assert.rejects(selfCheck(packageName, instrumenter, samples), {
      message: /made no mutants of LzOne, LzTwo from/,
    });
  });
});

describe('warnUntested', () => {
  const instrumenter = { dir: '/fake/instrumenter', version: '1.2.3' };

  it('warns when the instrumenter is not the tested version', () => {
    const warnings: string[] = [];

    warnUntested(packageName, '1.0.0', instrumenter, (message) =>
      warnings.push(message),
    );

    assert.deepEqual(warnings, [
      '@layzee/test-mutators was tested with @stryker-mutator/instrumenter 1.0.0, not 1.2.3 in /fake/instrumenter; ' +
        'its self-check passed.',
    ]);
  });

  it('says nothing when the instrumenter is the tested version', () => {
    const warnings: string[] = [];

    warnUntested(packageName, '1.2.3', instrumenter, (message) =>
      warnings.push(message),
    );

    assert.deepEqual(warnings, []);
  });
});
