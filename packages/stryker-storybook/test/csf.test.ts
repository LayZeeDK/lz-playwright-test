import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parse } from '@babel/parser';

import { csfFile, csfShapes, topLevelBindings } from '../src/csf.ts';
import { field, list } from '../src/node-field.ts';
import { parseProgram } from '../src/parse.ts';

const fileName = 'src/a.stories.tsx';

function stories(
  code: string,
): readonly (readonly [string, readonly unknown[]])[] {
  const body = list(field(parseProgram(code, fileName), 'body'));

  return csfFile(body, topLevelBindings(body)).stories.map(
    ({ name, children }) => [name, children] as const,
  );
}

describe('csfFile', () => {
  it('reports no __namedExportsOrder story', () => {
    assert.deepEqual(
      stories(
        "export default {};\nexport const A = {};\nexport const __namedExportsOrder = ['A'];",
      ),
      [['A', []]],
    );
  });

  it('reports no .test() children without a story index', () => {
    assert.deepEqual(
      stories(
        "import preview from '#.storybook/preview';\nconst meta = preview.meta({});\nexport const A = meta.story();\nA.test('runs', async () => undefined);",
      ),
      [['A', []]],
    );
  });

  it('reports no story for a default function export', () => {
    assert.deepEqual(
      stories('export default function Meta() {}\nexport const A = {};'),
      [['A', []]],
    );
  });

  it('reports no story for an exported class', () => {
    assert.deepEqual(
      stories('export default {};\nexport class A {}\nexport const B = {};'),
      [['B', []]],
    );
  });

  it('reports no story when a meta object is exported as default by specifier', () => {
    assert.deepEqual(
      stories(
        'const meta = {};\nexport { meta as default };\nexport const A = {};',
      ),
      [],
    );
  });

  it('reports each story that an includeStories array names', () => {
    assert.deepEqual(
      stories(
        "export default { includeStories: ['A', 'B'] };\nexport const A = {};\nexport const B = {};\nexport const C = {};",
      ),
      [
        ['A', []],
        ['B', []],
      ],
    );
  });

  it('matches includeStories with the flags of its regular expression', () => {
    assert.deepEqual(
      stories(
        'export default { includeStories: /^a$/i };\nexport const A = {};\nexport const B = {};',
      ),
      [['A', []]],
    );
  });

  for (const { name, code, expected } of [
    {
      name: 'a story whose method a top-level declaration calls',
      code: 'export default {};\nexport const A = {};\nconst b = A.toString();',
      expected: [['A', true]],
    },
    {
      name: 'a story held by an object property a call receives',
      code: 'export default {};\nexport const A = {};\nconsole.log({ a: A });',
      expected: [['A', true]],
    },
    {
      name: 'a namespace re-export, which has no local name',
      code: "export default {};\nexport * as ns from './x';",
      expected: [['ns', false]],
    },
    {
      name: 'a story named only in a typeof type query',
      code: "export default {};\nexport const A = {};\ntype T = typeof A;\nexport * as ns from './x';",
      expected: [
        ['A', false],
        ['ns', false],
      ],
    },
  ]) {
    it(`reports whether the file names a story elsewhere: ${name}`, () => {
      const body = list(field(parseProgram(code, fileName), 'body'));

      assert.deepEqual(
        csfFile(body, topLevelBindings(body)).stories.map(
          ({ name: story, referencedElsewhere }) => [
            story,
            referencedElsewhere,
          ],
        ),
        expected,
      );
    });
  }
});

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
