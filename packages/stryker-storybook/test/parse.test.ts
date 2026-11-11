import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseProgram } from '../src/parse.ts';

describe('parseProgram', () => {
  it('parses a decorated class in a TypeScript story file', () => {
    const program = parseProgram(
      "@Component({ template: '' })\nclass Host {}\n",
      'Host.stories.ts',
    );

    assert.equal(program.body[0]?.type, 'ClassDeclaration');
  });

  ['Label.stories.ts', 'Label.stories.mts', 'Label.stories.cts'].forEach(
    (fileName) => {
      it(`parses an angle-bracket type assertion in ${fileName}`, () => {
        const program = parseProgram(
          'declare const value: unknown;\nexport const label = <string>value;\n',
          fileName,
        );

        assert.equal(program.body[1]?.type, 'ExportNamedDeclaration');
      });
    },
  );
});
