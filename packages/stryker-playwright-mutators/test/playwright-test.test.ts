import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { looksLikePlaywrightTest } from '../src/playwright-test.ts';
import { programOf } from './support/parse.ts';

describe('looksLikePlaywrightTest', () => {
  it('is false for a file with no @playwright/ import and no top-level test call', async () => {
    const program = await programOf(
      'export function total(a: number, b: number) {\n  return a + b;\n}\n',
    );

    assert.equal(looksLikePlaywrightTest(program), false);
  });

  for (const source of [
    "import { test } from '@playwright/test';\n",
    "import { mount } from '@playwright/experimental-ct-react';\n",
    "import type { Page } from '@playwright/test';\n",
  ]) {
    it(`is true for a file with an @playwright/ import: ${source.trim()}`, async () => {
      assert.equal(looksLikePlaywrightTest(await programOf(source)), true);
    });
  }

  for (const source of [
    "import { chunk } from 'lodash';\n",
    "import { x } from '@playwrightx/foo';\n",
    "import { chromium } from 'playwright-core';\n",
  ]) {
    it(`is false for a file whose imports are not @playwright/: ${source.trim()}`, async () => {
      assert.equal(looksLikePlaywrightTest(await programOf(source)), false);
    });
  }

  for (const source of [
    "test('a', async () => {});\n",
    "test.describe('a', () => {});\n",
    'test.beforeEach(async () => {});\n',
  ]) {
    it(`is true for a file with a top-level test call: ${source.trim()}`, async () => {
      assert.equal(looksLikePlaywrightTest(await programOf(source)), true);
    });
  }

  for (const source of [
    "function register() {\n  test('a', () => {});\n}\n",
    "foo.test('a', () => {});\n",
    "describe('a', () => {});\n",
    'expect(1).toBe(1);\n',
  ]) {
    it(`is false for a file with no top-level test call: ${source.trim().replace(/\n/g, ' ')}`, async () => {
      assert.equal(looksLikePlaywrightTest(await programOf(source)), false);
    });
  }
});
