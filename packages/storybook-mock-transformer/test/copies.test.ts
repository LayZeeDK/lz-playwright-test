import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const copies = [
  {
    file: 'stub-shape.ts',
    source: '../../stryker-storybook/src/stub-shape.ts',
  },
  {
    file: 'stryker-record.ts',
    source: '../../stryker-storybook/src/stryker-record.ts',
  },
];

function read(path: string): string {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

describe('copied files', () => {
  copies.forEach(({ file, source }) => {
    it(`src/${file} is a byte copy of its owner's file`, () => {
      assert.equal(
        read(`../src/${file}`),
        read(source),
        `src/${file} differs from packages/stryker-storybook/src/${file}; copy the owner's file over it`,
      );
    });
  });
});
