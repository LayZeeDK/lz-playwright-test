// Each case must give exactly the mutants it lists, through the real instrumenter with the real install and the
// given options. The install and the instrumentation run in a before hook, so that an error there fails every case
// instead of the file.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { before, test } from 'node:test';

import {
  lzPlaywrightMutators,
  type LzPlaywrightMutatorOptions,
} from '../../src/index.ts';
import { resolveFromCore } from '../../src/install.ts';
import type { Case } from '../cases.ts';
import { mutantsOf, type Mutant } from './mutants.ts';

function fileOf(testCase: Case): string {
  return join(import.meta.dirname, '..', 'out', `${testCase.id}.spec.ts`);
}

export function runCases(
  cases: readonly Case[],
  options?: LzPlaywrightMutatorOptions,
  testModule = '@playwright/test',
): void {
  const source = (testCase: Case): string =>
    `import { expect, test } from '${testModule}';\n\n${testCase.source}\n`;

  let mutants: readonly Mutant[];

  before(async () => {
    const instrumenter = await resolveFromCore();

    await lzPlaywrightMutators(options);
    mutants = await mutantsOf(
      instrumenter,
      cases.map((testCase) => ({
        name: fileOf(testCase),
        content: source(testCase),
      })),
    );
  });

  cases.forEach((testCase) => {
    test(`${testCase.id}: ${testCase.title}`, () => {
      const actual = mutants
        .filter(({ fileName }) => fileName === fileOf(testCase))
        .map(({ mutatorName, replacement }) => `${mutatorName} ${replacement}`)
        .sort();
      const expected = testCase.expect
        .map(([mutator, replacement]) => `${mutator} ${replacement}`)
        .sort();

      assert.deepEqual(actual, expected);
    });
  });
}
