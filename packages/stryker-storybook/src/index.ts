import { declareFactoryPlugin, PluginKind } from '@stryker-mutator/api/plugin';

import { csfIgnorer } from './csf-ignorer.ts';
import { storybookReporter } from './reporter.ts';
import { stubIgnorer } from './stub-ignorer.ts';

export type { LzStorybookOptions } from './options.ts';
export type { LzStorybookReport } from './reporter.ts';

/**
 * Stryker reads one schema per plugin module, so it names the options of every plugin here. Core merges its
 * `properties` into its own (meta-schema-builder.js:27).
 */
export const strykerValidationSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  properties: {
    lzStorybook: {
      type: 'object',
      default: {},
      additionalProperties: false,
      description: 'Options of the lz-storybook and lz-storybook-csf plugins.',
      properties: {
        configDir: {
          type: 'string',
          default: '.storybook',
          description:
            'The Storybook config folder, as Storybook takes it with --config-dir. Its main file names the story files.',
        },
      },
    },
    lzStorybookCsf: {
      type: 'object',
      default: {},
      additionalProperties: false,
      description: 'Options of the lz-storybook-csf ignorer.',
      properties: {
        play: {
          enum: ['ignore', 'mutate'],
          default: 'ignore',
          description:
            'ignore (the default) keeps the mutants of plays, test hooks and msw handlers in story files out of ' +
            'the run, for a config that mutates app code. mutate keeps them in, for a config that mutates test code.',
        },
      },
    },
  },
};

export const strykerPlugins = [
  declareFactoryPlugin(PluginKind.Ignore, 'lz-storybook-csf', csfIgnorer),
  declareFactoryPlugin(PluginKind.Ignore, 'lz-storybook', stubIgnorer),
  declareFactoryPlugin(PluginKind.Reporter, 'lz-storybook', storybookReporter),
];
