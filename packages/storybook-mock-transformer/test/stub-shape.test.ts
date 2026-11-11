import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parse } from '@babel/parser';

import { definitionTimeStubs } from '../src/stub-shape.ts';

describe('definitionTimeStubs', () => {
  it('reports a Once stub as once, under the method it stubs', () => {
    const { program } = parse(
      "import { fn } from 'storybook/test';\nfn().mockResolvedValueOnce(1);",
      { sourceType: 'module' },
    );

    assert.deepEqual(
      definitionTimeStubs(program).map(({ method, once }) => ({
        method,
        once,
      })),
      [{ method: 'mockResolvedValue', once: true }],
    );
  });
});
