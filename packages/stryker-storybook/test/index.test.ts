import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { commonTokens } from '@stryker-mutator/api/plugin';
import { Ajv } from 'ajv';

import { csfIgnorer } from '../src/csf-ignorer.ts';
import * as entry from '../src/index.ts';
import { strykerPlugins, strykerValidationSchema } from '../src/index.ts';
import { storybookReporter } from '../src/reporter.ts';
import { lzStorybookStrykerPlugin } from '../src/stryker-vite-plugin.ts';
import { stubIgnorer } from '../src/stub-ignorer.ts';

describe('package entry', () => {
  // Stryker loads a plugin module by its package name.
  it('is the module the package name resolves to', () => {
    assert.equal(
      import.meta.resolve('@layzee/stryker-storybook'),
      new URL('../src/index.ts', import.meta.url).href,
    );
  });

  it('exports the Vite plugin for the Vitest config that Stryker runs', () => {
    assert.equal(entry.lzStorybookStrykerPlugin, lzStorybookStrykerPlugin);
  });

  it('declares the CSF ignorer, the stub ignorer and the reporter', () => {
    assert.deepEqual(
      strykerPlugins.map(({ kind, name, factory }) => ({
        kind,
        name,
        factory,
      })),
      [
        { kind: 'Ignore', name: 'lz-storybook-csf', factory: csfIgnorer },
        { kind: 'Ignore', name: 'lz-storybook', factory: stubIgnorer },
        { kind: 'Reporter', name: 'lz-storybook', factory: storybookReporter },
      ],
    );
  });

  it('has Stryker pass each plugin the options and the logger', () => {
    assert.deepEqual(
      strykerPlugins.map(({ factory }) =>
        'inject' in factory ? factory.inject : undefined,
      ),
      [
        [commonTokens.options, commonTokens.logger],
        [commonTokens.options, commonTokens.logger],
        [commonTokens.options, commonTokens.logger],
      ],
    );
  });
});

// The Ajv settings of Stryker's OptionsValidator (@stryker-mutator/core, src/config/options-validator.ts), which checks
// a config against the schema a plugin exports.
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

describe('strykerValidationSchema', () => {
  it("fills in the defaults in Stryker's check of the options", () => {
    assert.deepEqual(validate({}), {
      valid: true,
      options: {
        lzStorybook: { configDir: '.storybook' },
        lzStorybookCsf: { play: 'ignore' },
      },
    });
  });

  it('rejects a config folder that is not a string', () => {
    assert.equal(validate({ lzStorybook: { configDir: 42 } }).valid, false);
  });

  it('rejects a play mode other than ignore and mutate', () => {
    assert.equal(validate({ lzStorybookCsf: { play: 'skip' } }).valid, false);
  });

  it('accepts the mutate play mode', () => {
    assert.equal(validate({ lzStorybookCsf: { play: 'mutate' } }).valid, true);
  });

  it('rejects an lzStorybook key it does not know', () => {
    assert.equal(validate({ lzStorybook: { configdir: 'sb' } }).valid, false);
  });

  it('rejects an lzStorybookCsf key it does not know', () => {
    assert.equal(
      validate({ lzStorybookCsf: { plays: 'mutate' } }).valid,
      false,
    );
  });

  it('rejects lzStorybook when it is not an object', () => {
    assert.equal(validate({ lzStorybook: '.storybook' }).valid, false);
  });

  it('rejects lzStorybookCsf when it is not an object', () => {
    assert.equal(validate({ lzStorybookCsf: 'mutate' }).valid, false);
  });
});
