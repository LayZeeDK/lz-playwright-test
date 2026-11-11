import { declareFactoryPlugin, PluginKind } from '@stryker-mutator/api/plugin';

import { csfIgnorer, csfIgnorerName } from './csf-ignorer.ts';
import { playModes } from './options.ts';
import { storybookReporter } from './reporter.ts';
import { stubIgnorer } from './stub-ignorer.ts';
import { storybookPluginName } from './stub-verdict.ts';

export type { LzStorybookCsfOptions, LzStorybookOptions } from './options.ts';
export type { LzStorybookReport } from './reporter.ts';

/**
 * Stryker reads one schema per plugin module, so it names the options of every plugin here. Core merges its
 * `properties` into its own (meta-schema-builder.js:27).
 */
export const strykerValidationSchema = {
  type: 'object',
  properties: {
    lzStorybook: {
      type: 'object',
      default: {},
      additionalProperties: false,
      // Stryker disable next-line StringLiteral: no Stryker message or editor schema shows plugin option descriptions
      description: 'Options of the lz-storybook and lz-storybook-csf plugins.',
      properties: {
        configDir: {
          type: 'string',
          default: '.storybook',
          description:
            // Stryker disable next-line StringLiteral: no Stryker message or editor schema shows plugin option descriptions
            'The Storybook config folder, as Storybook takes it with --config-dir. Its main file names the story files.',
        },
      },
    },
    lzStorybookCsf: {
      type: 'object',
      default: {},
      additionalProperties: false,
      // Stryker disable next-line StringLiteral: no Stryker message or editor schema shows plugin option descriptions
      description: 'Options of the lz-storybook-csf ignorer.',
      properties: {
        play: {
          enum: playModes,
          default: 'ignore',
          // Stryker disable StringLiteral: no Stryker message or editor schema shows plugin option descriptions
          description:
            'ignore (the default) keeps the mutants of plays, test hooks and msw handlers in story files out of ' +
            'the run, for a config that mutates app code. mutate keeps them in, for a config that mutates test code.',
          // Stryker restore StringLiteral
        },
      },
    },
  },
};

export const strykerPlugins = [
  declareFactoryPlugin(PluginKind.Ignore, csfIgnorerName, csfIgnorer),
  declareFactoryPlugin(PluginKind.Ignore, storybookPluginName, stubIgnorer),
  declareFactoryPlugin(
    PluginKind.Reporter,
    storybookPluginName,
    storybookReporter,
  ),
];
