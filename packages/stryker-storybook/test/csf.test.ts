import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parse } from '@babel/parser';

import { csfShapes } from '../src/csf.ts';
import { field } from '../src/node-field.ts';

describe('csfShapes', () => {
  it('reads a parenthesized story object when the parser keeps parentheses as nodes', () => {
    const shapes = csfShapes(
      parse(
        "export default { title: 'a/b' };\nexport const A = ({ args: {} });",
        {
          sourceType: 'module',
          createParenthesizedExpressions: true,
        },
      ).program,
    );

    assert.deepEqual(
      [...shapes.literalContainers].map((node) => field(node, 'type')),
      ['ObjectExpression'],
    );
  });
});
