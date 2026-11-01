import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { strykerPlugins } from '../src/index.ts';

const packageJson: unknown = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
);
const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');

function field(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null
    ? Object.entries(value).find(([name]) => name === key)?.[1]
    : undefined;
}

async function readmeConfig(): Promise<unknown> {
  const block = /```ts\n([\s\S]*?export default[\s\S]*?)```/.exec(readme)?.[1];
  assert.ok(block, 'the README has a ts block with the Stryker config');
  const source = block
    .replace(/^import type .*$/m, '')
    .replace(/\s+satisfies PartialStrykerOptions/, '');
  const module: unknown = await import(
    `data:text/javascript,${encodeURIComponent(source)}`
  );

  return field(module, 'default');
}

const init = field(packageJson, 'initStrykerConfig');

test('stryker init selects the test runner the package declares', () => {
  assert.deepEqual(field(init, 'appendPlugins'), [field(packageJson, 'name')]);
  assert.equal(field(init, 'testRunner'), strykerPlugins[0]?.name);
});

test("stryker init's comment links the package homepage", () => {
  const comment = field(init, 'testRunner_comment');
  const homepage = field(packageJson, 'homepage');
  assert.equal(typeof homepage, 'string');
  assert.equal(typeof comment, 'string');
  assert.ok(String(comment).includes(String(homepage)));
});

test('stryker init writes the settings the README recommends', async () => {
  const config = await readmeConfig();
  const settings = Object.keys(init ?? {}).filter(
    (key) => key !== 'testRunner_comment',
  );

  for (const key of settings) {
    assert.deepEqual(field(config, key), field(init, key), key);
  }

  assert.deepEqual(
    Object.keys(config ?? {}).filter((key) => key !== 'mutate'),
    settings,
  );
});
