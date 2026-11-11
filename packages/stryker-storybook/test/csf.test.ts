import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

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
  it('reports no undefined value for what the file leaves out', () => {
    const shapes = csfShapes(
      parseProgram(
        "export default { title: 'a/b' };\nexport const A = {};",
        fileName,
      ),
    );

    assert.deepEqual(
      [
        shapes.metaObjects,
        shapes.literalContainers,
        shapes.testCode,
        shapes.mswValues,
        shapes.staticValues,
      ].map((set) => set.has(undefined)),
      [false, false, false, false, false],
    );
  });
});
