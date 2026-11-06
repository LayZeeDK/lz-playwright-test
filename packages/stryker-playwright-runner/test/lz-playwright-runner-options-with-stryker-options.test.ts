import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import { Ajv } from 'ajv';

import {
  optionProperties,
  readRunnerOptions,
  strykerValidationSchema,
} from '../src/lz-playwright-runner-options-with-stryker-options.ts';
import {
  minTestTimeoutMs,
  runStartMs,
  stopHeadroomMs,
} from '../src/timeouts.ts';
import { strykerOptions } from './support/doubles.ts';

const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
const readmeOptions = readme
  .split(/^## /m)
  .find((section) => section.startsWith('Options\n'));

const defaults = {
  configFile: undefined,
  projects: undefined,
  workers: 1,
  retries: undefined,
  survivorTraces: undefined,
  traceScreenshots: false,
  webServer: { mutate: false, isolate: true },
  strykerTimeoutMS: 10_000,
};

test('the runner options resolve the config file and take the schema default for workers', () => {
  assert.deepEqual(
    readRunnerOptions(
      strykerOptions({
        lzPlaywright: { configFile: 'e2e/playwright.config.ts' },
      }),
    ),
    { ...defaults, configFile: path.resolve('e2e/playwright.config.ts') },
  );
});

test('the runner options keep the projects and workers the user set', () => {
  const options = readRunnerOptions(
    strykerOptions({
      lzPlaywright: { projects: ['chromium'], workers: 2, retries: 0 },
    }),
  );

  assert.equal(options.configFile, undefined);
  assert.deepEqual(options.projects, ['chromium']);
  assert.equal(options.workers, 2);
  assert.equal(options.retries, 0);
});

test('the runner options refuse --testFiles', () => {
  assert.throws(
    () => readRunnerOptions(strykerOptions({ testFiles: ['a.spec.ts'] })),
    { message: /--testFiles/ },
  );
});

test('the runner options refuse lzPlaywright options that are not an object or have a field of the wrong type, or a workers count that is no integer of at least 1', () => {
  [
    'chromium',
    [],
    { workers: null },
    { configFile: 1 },
    { projects: 'chromium' },
    { projects: ['chromium', 1] },
    { workers: '2' },
    { workers: 1.5 },
    { workers: 0 },
    { retries: '1' },
    { retries: 0.5 },
    { retries: -1 },
    { survivorTraces: 1 },
    { traceScreenshots: 'on' },
  ].forEach((lzPlaywright) => {
    assert.throws(() => readRunnerOptions(strykerOptions({ lzPlaywright })), {
      message: `The lzPlaywright options do not match their schema: ${JSON.stringify(lzPlaywright)}`,
    });
  });
});

test('without lzPlaywright options or with an empty --testFiles the runner takes its defaults', () => {
  assert.deepEqual(readRunnerOptions(strykerOptions({})), defaults);
  assert.deepEqual(
    readRunnerOptions(strykerOptions({ testFiles: [] })),
    defaults,
  );
});

test('without a webServer option the runner leaves server mutants alone and isolates server runs', () => {
  assert.deepEqual(readRunnerOptions(strykerOptions({})).webServer, {
    mutate: false,
    isolate: true,
  });
});

test('webServer.isolate: false keeps the default for mutate', () => {
  assert.deepEqual(
    readRunnerOptions(
      strykerOptions({ lzPlaywright: { webServer: { isolate: false } } }),
    ).webServer,
    { mutate: false, isolate: false },
  );
});

test('webServer.mutate: true turns server mutants on', () => {
  assert.deepEqual(
    readRunnerOptions(
      strykerOptions({ lzPlaywright: { webServer: { mutate: true } } }),
    ).webServer,
    { mutate: true, isolate: true },
  );
});

test("webServer.mutate: 'auto' is kept for the runner to decide", () => {
  assert.deepEqual(
    readRunnerOptions(
      strykerOptions({ lzPlaywright: { webServer: { mutate: 'auto' } } }),
    ).webServer,
    { mutate: 'auto', isolate: true },
  );
});

test('webServer.mutate refuses any value but true, false or auto, and names them', () => {
  assert.throws(
    () =>
      readRunnerOptions(
        strykerOptions({ lzPlaywright: { webServer: { mutate: 'on' } } }),
      ),
    {
      message:
        'lzPlaywright.webServer.mutate must be true, false or \'auto\', got "on".',
    },
  );
});

test('webServer.isolate refuses anything but true or false', () => {
  assert.throws(
    () =>
      readRunnerOptions(
        strykerOptions({ lzPlaywright: { webServer: { isolate: 'no' } } }),
      ),
    {
      message: 'lzPlaywright.webServer.isolate must be true or false, got "no".',
    },
  );
});

test('webServer refuses anything but an object', () => {
  [true, 'auto', null, []].forEach((webServer) => {
    assert.throws(
      () => readRunnerOptions(strykerOptions({ lzPlaywright: { webServer } })),
      {
        message: `lzPlaywright.webServer must be an object with mutate and isolate, got ${JSON.stringify(webServer)}.`,
      },
    );
  });
});

test('webServer refuses an option it does not have, and names the ones it has', () => {
  assert.throws(
    () =>
      readRunnerOptions(
        strykerOptions({
          lzPlaywright: { webServer: { mutate: true, port: 3000 } },
        }),
      ),
    {
      message:
        'lzPlaywright.webServer has no option port; it takes mutate and isolate.',
    },
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
    options: { lzPlaywright: { workers: 1, traceScreenshots: false } },
  });
  assert.deepEqual(
    validate({
      lzPlaywright: {
        configFile: 'a.ts',
        projects: ['chromium'],
        workers: 2,
        retries: 1,
      },
    }).valid,
    true,
  );
});

test("Stryker's check of the options refuses wrong types, workers below 1 and unknown options", () => {
  [
    { configFile: 1 },
    { projects: 'chromium' },
    { projects: [1] },
    { workers: 1.5 },
    { workers: 0 },
    { retries: -1 },
    { traceScreenshots: 'on' },
    { browser: 'chromium' },
  ].forEach((lzPlaywright) => {
    assert.equal(
      validate({ lzPlaywright }).valid,
      false,
      JSON.stringify(lzPlaywright),
    );
  });

  assert.equal(validate({ lzPlaywright: [] }).valid, false);
});

test("Stryker's check of the options takes webServer with mutate true, false or auto and a boolean isolate, and nothing else", () => {
  [
    { mutate: true },
    { mutate: false, isolate: true },
    { mutate: 'auto', isolate: false },
  ].forEach((webServer) => {
    assert.equal(
      validate({ lzPlaywright: { webServer } }).valid,
      true,
      JSON.stringify(webServer),
    );
  });
  [true, [], { mutate: 'on' }, { isolate: 'no' }, { port: 1 }].forEach(
    (webServer) => {
      assert.equal(
        validate({ lzPlaywright: { webServer } }).valid,
        false,
        JSON.stringify(webServer),
      );
    },
  );
});

test('every option says what it is for', () => {
  Object.entries(optionProperties).forEach(([name, { description }]) => {
    assert.match(description, /^[A-Z].{20,}\.$/, name);
  });

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

  assert.deepEqual(listed, Object.keys(optionProperties));
});

test('the README states the per-test timeout the runner sets', () => {
  const [, headroom, floor] =
    /less ([\d.]+) s but\s+at\s+least\s+([\d.]+) s/.exec(readme) ?? [];

  assert.equal(Number(headroom) * 1000, runStartMs + stopHeadroomMs);
  assert.equal(Number(floor) * 1000, minTestTimeoutMs);
});

test('the README states when the runner stops a mutant run, and below which timeout it does not', () => {
  const [, headroom] = /still\s+going\s+([\d.]+) s before/.exec(readme) ?? [];
  const [, noStopBelow] =
    /timeout\s+is\s+under\s+([\d.]+) s/.exec(readme) ?? [];

  assert.equal(Number(headroom) * 1000, stopHeadroomMs);
  assert.equal(
    Number(noStopBelow) * 1000,
    runStartMs + minTestTimeoutMs + stopHeadroomMs,
  );
});
