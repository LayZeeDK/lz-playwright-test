import { declareClassPlugin, PluginKind } from '@stryker-mutator/api/plugin';

import { PlaywrightTestRunner } from './playwright-test-runner.ts';

export const strykerPlugins = [declareClassPlugin(PluginKind.TestRunner, 'playwright', PlaywrightTestRunner)];

export const strykerValidationSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  properties: {
    playwright: {
      type: 'object',
      default: {},
      additionalProperties: false,
      properties: {
        configFile: {
          type: 'string',
          description: 'Path to the Playwright config file, relative to the project root.',
        },
        projects: {
          type: 'array',
          items: { type: 'string' },
          description: 'Playwright projects to run. Defaults to every project in the config.',
        },
        workers: {
          type: 'number',
          default: 1,
          description: 'Playwright workers per Stryker test runner process.',
        },
      },
    },
  },
};
