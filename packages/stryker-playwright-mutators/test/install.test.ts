import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { markOf } from '@layzee/stryker-mutator-install';

import { assertBabelTypes, install } from '../src/install.ts';
import {
  fakeInstrumenter,
  ownMark,
  sets,
} from './support/fake-instrumenter.ts';

describe('assertBabelTypes', () => {
  const missing = (name: string) => new Error(`no ${name}`);

  it('accepts an object', () => {
    assert.doesNotThrow(() => assertBabelTypes({}, missing));
  });

  it('rejects a value that is no object, through the missing-member error', () => {
    for (const value of [undefined, null, 'types']) {
      assert.throws(() => assertBabelTypes(value, missing), {
        message: 'no Babel types',
      });
    }
  });
});

describe('install', () => {
  it("removes Stryker's 17 built-ins and appends the selected mutators, marked", async () => {
    const { instrumenter, names } = fakeInstrumenter();

    await install(
      sets(['LzOne', 'LzTwo']),
      undefined,
      async () => instrumenter,
      () => undefined,
      () => undefined,
    );

    assert.deepEqual(names(), ['LzOne', 'LzTwo']);
    assert.equal(
      instrumenter.allMutators.every((listed) => ownMark in listed),
      true,
    );
  });

  it('refuses a name that another mutator holds, ignoring case, and registers nothing', async () => {
    const { instrumenter, names } = fakeInstrumenter({
      extra: [{ name: 'lzone', mutate: () => undefined }],
    });

    await assert.rejects(
      install(
        sets(['LzOne', 'LzTwo']),
        undefined,
        async () => instrumenter,
        () => undefined,
        () => undefined,
      ),
      {
        message:
          '@layzee/stryker-playwright-mutators: another mutator already has the name LzOne.',
      },
    );
    assert.deepEqual(names(), ['lzone']);
  });

  it('leaves exactly the second selection when it is called twice, and keeps the mutators of other packages', async () => {
    const sibling = {
      name: 'LzSibling',
      mutate: () => undefined,
      [markOf('@layzee/stryker-jsx-mutators')]: 1,
    };
    const { instrumenter, names } = fakeInstrumenter({ extra: [sibling] });
    const list = instrumenter.allMutators;
    const run = (mutatorNames: readonly string[]) =>
      install(
        sets(mutatorNames),
        undefined,
        async () => instrumenter,
        () => undefined,
        () => undefined,
      );

    await run(['LzOne', 'LzTwo']);
    await run(['LzTwo', 'LzThree']);

    assert.deepEqual(names(), ['LzSibling', 'LzTwo', 'LzThree']);
    assert.equal(instrumenter.allMutators, list);
  });

  it('prints one start line that counts the mutators on', async () => {
    const { instrumenter } = fakeInstrumenter();
    const lines: string[] = [];

    await install(
      sets(['LzOne', 'LzTwo']),
      undefined,
      async () => instrumenter,
      () => undefined,
      (message) => lines.push(message),
    );

    assert.deepEqual(lines, [
      "@layzee/stryker-playwright-mutators: Stryker's 17 built-in mutators are off for every file in this run; 2 " +
        'LzPlaywright mutators on.',
    ]);
  });

  it('names the opt-in and experimental mutators that are on in the start line, in the order of the roster', async () => {
    const { instrumenter } = fakeInstrumenter();
    const lines: string[] = [];

    await install(
      sets(['LzOne'], ['LzTwo', 'LzThree'], ['LzFour']),
      { LzThree: true, experimental: true },
      async () => instrumenter,
      () => undefined,
      (message) => lines.push(message),
    );

    assert.deepEqual(lines, [
      "@layzee/stryker-playwright-mutators: Stryker's 17 built-in mutators are off for every file in this run; 3 " +
        'LzPlaywright mutators on. Opt-in or experimental: LzThree, LzFour.',
    ]);
  });

  it('prints no start line when a check throws', async () => {
    const { instrumenter } = fakeInstrumenter({ silent: ['LzOne'] });
    const lines: string[] = [];

    await assert.rejects(
      install(
        sets(['LzOne']),
        undefined,
        async () => instrumenter,
        () => undefined,
        (message) => lines.push(message),
      ),
    );

    assert.deepEqual(lines, []);
  });

  it('warns about an instrumenter version it was not tested with, after both checks passed', async () => {
    const { instrumenter } = fakeInstrumenter({ version: '10.2.0' });
    const warnings: string[] = [];

    await install(
      sets(['LzOne']),
      undefined,
      async () => instrumenter,
      (message) => warnings.push(message),
      () => undefined,
    );

    assert.deepEqual(warnings, [
      '@layzee/stryker-playwright-mutators was tested with @stryker-mutator/instrumenter 10.1.1, not 10.2.0 in ' +
        '/stryker/instrumenter; its self-check passed.',
    ]);
  });

  it('throws, naming the built-ins that still made a mutant after the removal', async () => {
    const { instrumenter } = fakeInstrumenter({
      leaking: ['Regex', 'ArrowFunction'],
    });

    await assert.rejects(
      install(
        sets(['LzOne']),
        undefined,
        async () => instrumenter,
        () => undefined,
        () => undefined,
      ),
      {
        message:
          '@layzee/stryker-playwright-mutators: the instrumenter 10.1.1 in /stryker/instrumenter still made mutants of the ' +
          'built-ins ArrowFunction, Regex after this package removed them, so it does not run the list this package changed. ' +
          'A bundled or second copy of the instrumenter does that.',
      },
    );
  });

  it('throws, naming every selected mutator whose sample made no mutant', async () => {
    const { instrumenter } = fakeInstrumenter({ silent: ['LzOne', 'LzThree'] });

    await assert.rejects(
      install(
        sets(['LzOne', 'LzTwo', 'LzThree']),
        undefined,
        async () => instrumenter,
        () => undefined,
        () => undefined,
      ),
      {
        message:
          '@layzee/stryker-playwright-mutators: the instrumenter 10.1.1 in /stryker/instrumenter made no mutants of LzOne, ' +
          'LzThree from their samples, so it does not run the mutators this module added. A bundled or second copy of the ' +
          'instrumenter does that.',
      },
    );
  });
});
