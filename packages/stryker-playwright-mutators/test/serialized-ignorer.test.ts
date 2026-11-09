import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { builtInNames } from '@layzee/stryker-mutator-install';

import { strykerPlugins } from '../src/index.ts';
import { resolveFromCore } from '../src/install.ts';
import { serializedIgnorer } from '../src/serialized-ignorer.ts';
import { assertEveryOutcome } from './support/ignorer-outcomes.ts';

const reasonFor = (method: string) =>
  `lz-playwright-serialized: Playwright's ${method} runs this function's source text where Stryker's helpers do not exist`;

const assertEvery = (code: string, outcome: string) =>
  assertEveryOutcome(serializedIgnorer, code, outcome);

describe('lz-playwright-serialized', () => {
  it('ignores every mutant of an arrow function passed to evaluate, with a reason naming evaluate', async () => {
    await assertEvery(
      "export const title = page.evaluate(() => document.title === 'a' ? 1 : 2);",
      reasonFor('evaluate'),
    );
  });

  [
    { method: 'evaluateHandle', call: 'page.evaluateHandle(' },
    { method: 'evaluateAll', call: 'list.evaluateAll(' },
    { method: '$eval', call: 'frame.$eval(heading, ' },
    { method: '$$eval', call: 'page.$$eval(items, ' },
    { method: 'addInitScript', call: 'context.addInitScript(' },
    { method: 'waitForFunction', call: 'page.waitForFunction(' },
  ].forEach(({ method, call }) => {
    it(`ignores every mutant of a function passed to ${method}, with a reason naming ${method}`, async () => {
      await assertEvery(
        `export const title = ${call}() => document.title === 'a' ? 1 : 2);`,
        reasonFor(method),
      );
    });
  });

  it('ignores every mutant of a function expression passed to evaluate', async () => {
    await assertEvery(
      "export const title = page.evaluate(function () { return document.title === 'a' ? 1 : 2; });",
      reasonFor('evaluate'),
    );
  });

  it('keeps the mutants of a function passed to evaluate by variable', async () => {
    await assertEvery(
      "const title = () => document.title === 'a' ? 1 : 2;\npage.evaluate(title);",
      'placed',
    );
  });

  it('keeps the mutants of an argument to evaluate that is not a function', async () => {
    await assertEvery(
      "export const title = page.evaluate(read, on === 'a' ? 1 : 2);",
      'placed',
    );
  });

  it('keeps the mutants of a function passed to a method that does not serialize it', async () => {
    await assertEvery(
      "export const routed = page.route('**', () => document.title === 'a' ? 1 : 2);",
      'placed',
    );
  });

  it('keeps the mutants of a function passed to a computed member, even one read through a variable named evaluate', async () => {
    await assertEvery(
      "export const title = page[evaluate](() => document.title === 'a' ? 1 : 2);",
      'placed',
    );
  });

  it('keeps the mutants of a function passed to a plain call named evaluate', async () => {
    await assertEvery(
      "export const title = evaluate(() => document.title === 'a' ? 1 : 2);",
      'placed',
    );
  });

  it("gives a function nested in an ignored callback the callback's reason, because Stryker asks no ignorer about nodes inside an ignored one", async () => {
    await assertEvery(
      "export const title = page.evaluate(() => [1].map((n) => frame.waitForFunction(() => n === 1 ? 'a' : 'b')));",
      reasonFor('evaluate'),
    );
  });
});

describe('strykerPlugins', () => {
  it('declares the ignorer as the Ignore plugin lz-playwright-serialized', () => {
    assert.deepEqual(strykerPlugins, [
      {
        kind: 'Ignore',
        name: 'lz-playwright-serialized',
        value: serializedIgnorer,
      },
    ]);
  });

  it("leaves Stryker's mutators as they are when the package is imported for its plugins", async () => {
    const { allMutators } = await resolveFromCore();

    assert.deepEqual(
      allMutators.map(({ name }) => name).sort(),
      [...builtInNames].sort(),
    );
  });
});
