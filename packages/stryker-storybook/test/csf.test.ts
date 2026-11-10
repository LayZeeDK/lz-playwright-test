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
