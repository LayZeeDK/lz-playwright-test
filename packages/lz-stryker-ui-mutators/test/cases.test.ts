// Each case must give exactly the UI mutants it lists, through the real instrumenter with the real install
// (support/installed.ts). The install and the instrumentation run in a before hook, so that an error there fails
// every case instead of the file.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { before, test } from 'node:test';

import { resolveFromCore, type InstrumentResult } from '../src/install.ts';
import { cases, type Case } from './cases.ts';
import { defined } from './support/defined.ts';
import { installInto, ours } from './support/installed.ts';

function source(testCase: Case): string {
  return `${testCase.setup ?? ''}\nexport function Case(props: any) {\n  return (${testCase.jsx});\n}\n`;
}

function normalize(code: string): string {
  return code.replace(/\s+/g, ' ').trim();
}

const files = cases.map((testCase) => ({
  name: join(import.meta.dirname, 'out', `${testCase.id}.tsx`),
  content: source(testCase),
}));
let result: InstrumentResult;

before(async () => {
  const instrumenter = await installInto(await resolveFromCore());
  result = await instrumenter.instrument(files);
});

cases.forEach((testCase, index) => {
  test(`${testCase.id}: ${testCase.title}`, () => {
    const file = defined(files[index]).name;
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
      const { content } = defined(result.files[index]);

      assert.ok(content.includes(testCase.instrumented), content);
    }
  });
});
