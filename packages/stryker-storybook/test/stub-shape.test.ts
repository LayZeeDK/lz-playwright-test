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
    [
      'names the stub method that the call uses',
      "import { fn } from 'storybook/test';\nfn().mockResolvedValue(1);",
      [{ spy: 'fn', method: 'mockResolvedValue', once: false }],
    ],
    [
      'finds no stub in a call to a mock method that is not a stub',
      "import { fn } from 'storybook/test';\nfn().mockName('load');",
      [],
    ],
    [
      'finds no stub on an fn imported from another module',
      "import { fn } from './fn';\nfn().mockReturnValue(1);",
      [],
    ],
    [
      'finds no stub on a storybook/test import other than fn',
      "import { spyOn } from 'storybook/test';\nspyOn(console, 'log').mockReturnValue(undefined);",
      [],
    ],
    [
      'finds no stub in a computed member call',
      "import { fn } from 'storybook/test';\nconst mockReturnValue = 'mockName';\nfn()[mockReturnValue]('load');",
      [],
    ],
    [
      'finds no stub when the stub method is called with new',
      "import { fn } from 'storybook/test';\nnew (fn().mockReturnValue)(1);",
      [],
    ],
    [
      'finds no stub on an object that new fn() creates',
      "import { fn } from 'storybook/test';\nnew fn().mockReturnValue(1);",
      [],
    ],
  ];

  rows.forEach(([name, source, expected]) => {
    it(name, () => {
      assert.deepEqual(stubsOf(source), expected);
    });
  });

  it('gives the position of the stub call and of its first argument', () => {
    const source =
      "import { fn } from 'storybook/test';\nexport const A = { args: { g: fn().mockReturnValue('x') } };";

    assert.deepEqual(
      definitionTimeStubs(parseProgram(source, 'A.stories.ts')),
      [
        {
          spy: 'fn',
          method: 'mockReturnValue',
          once: false,
          start: source.indexOf('fn()'),
          end: source.lastIndexOf(')') + 1,
          line: 2,
          argumentStart: source.indexOf("'x'"),
        },
      ],
    );
  });
});
