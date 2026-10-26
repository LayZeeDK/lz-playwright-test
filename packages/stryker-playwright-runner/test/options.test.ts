import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import type { StrykerOptions } from '@stryker-mutator/api/core';

import { OPTION_PROPERTIES, readRunnerOptions } from '../src/options.ts';
import {
  MIN_TEST_TIMEOUT_MS,
  TEST_TIMEOUT_HEADROOM_MS,
} from '../src/timeouts.ts';

const readmeOptions = readFileSync(
  new URL('../../../README.md', import.meta.url),
  'utf8',
)
  .split(/^## /m)
  .find((section) => section.startsWith('Options\n'));

function strykerOptions(options: object): StrykerOptions {
  return { timeoutMS: 10_000, ...options } as unknown as StrykerOptions;
}

test('the runner options resolve the config file and take the schema default for workers', () => {
  assert.deepEqual(
    readRunnerOptions(
      strykerOptions({
        playwright: { configFile: 'e2e/playwright.config.ts' },
      }),
    ),
    {
      configFile: path.resolve('e2e/playwright.config.ts'),
      projects: undefined,
      workers: 1,
      strykerTimeoutMS: 10_000,
    },
  );
});

test('the runner options keep the projects and workers the user set', () => {
  const options = readRunnerOptions(
    strykerOptions({ playwright: { projects: ['chromium'], workers: 2 } }),
  );

  assert.equal(options.configFile, undefined);
  assert.deepEqual(options.projects, ['chromium']);
  assert.equal(options.workers, 2);
});

test('the runner options refuse --testFiles', () => {
  assert.throws(
    () => readRunnerOptions(strykerOptions({ testFiles: ['a.spec.ts'] })),
    { message: /--testFiles/ },
  );
});

test('the README lists exactly the options the schema has', () => {
  assert.ok(readmeOptions, 'README.md has an Options section');
  const listed = [...readmeOptions.matchAll(/^- `(\w+)`:/gm)].map(
    ([, name]) => name,
  );

  assert.deepEqual(listed, Object.keys(OPTION_PROPERTIES));
});

test('the README states the per-test timeout the runner sets', () => {
  const [, headroom, floor] =
    /less (\d+) s but at least (\d+) s/.exec(readmeOptions ?? '') ?? [];

  assert.equal(Number(headroom) * 1000, TEST_TIMEOUT_HEADROOM_MS);
  assert.equal(Number(floor) * 1000, MIN_TEST_TIMEOUT_MS);
});
