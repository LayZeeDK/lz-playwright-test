// Each case must give exactly the UI mutants it lists, through the real instrumenter with the real install. Calls
// install() itself rather than importing index.ts, so the cases also run inside a Stryker worker, where
// STRYKER_MUTATOR_WORKER makes index.ts skip the install (a mutation run of this package).
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';

import { install, resolveFromCore } from '../src/install.ts';
import { operatorNames, operators } from '../src/operators.ts';
import { cases, type Case } from './cases.ts';

const instrumenter = await resolveFromCore();
await install(operators, async () => instrumenter);

function source(testCase: Case): string {
  return `${testCase.setup ?? ''}\nexport function Case(props: any) {\n  return (${testCase.jsx});\n}\n`;
}

function normalize(code: string): string {
  return code.replace(/\s+/g, ' ').trim();
}

const ours: ReadonlySet<string> = new Set(operatorNames);
const files = cases.map((testCase) => ({
  name: join(import.meta.dirname, 'out', `${testCase.id}.tsx`),
  content: source(testCase),
}));
const result = await instrumenter.instrument(files);

for (const [index, testCase] of cases.entries()) {
  test(`${testCase.id}: ${testCase.title}`, () => {
    const file = files[index]!.name;
    const actual = result.mutants
      .filter(
        ({ fileName, mutatorName }) =>
          fileName === file && ours.has(mutatorName),
      )
      .map(
        ({ mutatorName, replacement }) =>
          `${mutatorName} ${normalize(replacement)}`,
      )
      .sort();
    const expected = testCase.expect
      .map(([operator, replacement]) => `${operator} ${normalize(replacement)}`)
      .sort();

    assert.deepEqual(actual, expected, `origin ${testCase.origin}`);

    if (testCase.instrumented !== undefined) {
      assert.ok(
        result.files[index]!.content.includes(testCase.instrumented),
        result.files[index]!.content,
      );
    }
  });
}
