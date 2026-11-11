import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseProgram } from '../src/parse.ts';
import { definitionTimeStubs } from '../src/stub-shape.ts';

function stubsOf(source: string) {
  return definitionTimeStubs(parseProgram(source, 'X.stories.ts')).map(
    ({ spy, method, once }) => ({ spy, method, once }),
  );
}

describe('definitionTimeStubs', () => {
  const rows: readonly (readonly [string, string, readonly unknown[]])[] = [
    [
      'finds a stub whose call is optional',
      "import { fn } from 'storybook/test';\nfn().mockReturnValue?.(1);",
      [{ spy: 'fn', method: 'mockReturnValue', once: false }],
    ],
    [
      'finds a stub whose method is read through optional chaining',
      "import { fn } from 'storybook/test';\nfn()?.mockReturnValue(1);",
      [{ spy: 'fn', method: 'mockReturnValue', once: false }],
    ],
  ];

  rows.forEach(([name, source, expected]) => {
    it(name, () => {
      assert.deepEqual(stubsOf(source), expected);
    });
  });
});
