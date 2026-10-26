import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import { Ajv } from 'ajv';

import {
  OPTION_PROPERTIES,
  readRunnerOptions,
  strykerValidationSchema,
} from '../src/options.ts';
import {
  MIN_TEST_TIMEOUT_MS,
  STOP_HEADROOM_MS,
  TEST_TIMEOUT_HEADROOM_MS,
} from '../src/timeouts.ts';
import { strykerOptions } from './support/doubles.ts';

const readmeOptions = readFileSync(
  new URL('../../../README.md', import.meta.url),
  'utf8',
)
  .split(/^## /m)
  .find((section) => section.startsWith('Options\n'));

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

test('without playwright options or with an empty --testFiles the runner takes its defaults', () => {
  const defaults = {
    configFile: undefined,
    projects: undefined,
    workers: 1,
    strykerTimeoutMS: 10_000,
  };

  assert.deepEqual(readRunnerOptions(strykerOptions({})), defaults);
  assert.deepEqual(
    readRunnerOptions(strykerOptions({ testFiles: [] })),
    defaults,
  );
});

// The Ajv settings of Stryker's OptionsValidator (@stryker-mutator/core, src/config/options-validator.ts),
// which checks a config against the schema a plugin exports.
function validate(options: object) {
  const ajv = new Ajv({
    useDefaults: true,
    allErrors: true,
    jsPropertySyntax: true,
    verbose: true,
    logger: false,
    strict: false,
  });
  const check = ajv.compile(strykerValidationSchema);
  const copy = structuredClone(options);

  return { valid: check(copy), options: copy };
}

test("Stryker's check of the options fills in the defaults", () => {
  assert.deepEqual(validate({}), {
    valid: true,
    options: { playwright: { workers: 1 } },
  });
  assert.deepEqual(
    validate({
      playwright: { configFile: 'a.ts', projects: ['chromium'], workers: 2 },
    }).valid,
    true,
  );
});

test("Stryker's check of the options refuses wrong types, workers below 1 and unknown options", () => {
  for (const playwright of [
    { configFile: 1 },
    { projects: 'chromium' },
    { projects: [1] },
    { workers: 1.5 },
    { workers: 0 },
    { browser: 'chromium' },
  ]) {
    assert.equal(
      validate({ playwright }).valid,
      false,
      JSON.stringify(playwright),
    );
  }

  assert.equal(validate({ playwright: [] }).valid, false);
});

test('every option says what it is for', () => {
  for (const [name, { description }] of Object.entries(OPTION_PROPERTIES)) {
    assert.match(description, /^[A-Z].{20,}\.$/, name);
  }

  assert.equal(
    strykerValidationSchema.$schema,
    'http://json-schema.org/draft-07/schema#',
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
    /less ([\d.]+) s but at least ([\d.]+) s/.exec(readmeOptions ?? '') ?? [];

  assert.equal(Number(headroom) * 1000, TEST_TIMEOUT_HEADROOM_MS);
  assert.equal(Number(floor) * 1000, MIN_TEST_TIMEOUT_MS);
});

test('the README states when the runner stops a mutant run', () => {
  const [, headroom] =
    /still going ([\d.]+) s before/.exec(readmeOptions ?? '') ?? [];

  assert.equal(Number(headroom) * 1000, STOP_HEADROOM_MS);
});
