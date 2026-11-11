import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import * as entry from '../src/index.ts';
import { lzStorybookMockTransformerPlugin } from '../src/index.ts';
import { lzStorybookMockResetPlugin } from '../src/mock-reset.ts';
import { transform } from '../src/transform.ts';

describe('lzStorybookMockTransformerPlugin', () => {
  it('is named lz-storybook-mock-transformer', () => {
    assert.equal(
      lzStorybookMockTransformerPlugin().name,
      'lz-storybook-mock-transformer',
    );
  });

  it('runs before other plugins transform', () => {
    assert.equal(lzStorybookMockTransformerPlugin().enforce, 'pre');
  });

  it('transforms modules with the stub rewrite', () => {
    assert.equal(lzStorybookMockTransformerPlugin().transform, transform);
  });
});

describe('package entry', () => {
  it('exports the mock reset plugin', () => {
    assert.equal(entry.lzStorybookMockResetPlugin, lzStorybookMockResetPlugin);
  });
});
