import { declareClassPlugin, PluginKind } from '@stryker-mutator/api/plugin';

import { PlaywrightTestRunner } from './playwright-test-runner.ts';

export { strykerValidationSchema } from './options.ts';

export const strykerPlugins = [
  declareClassPlugin(PluginKind.TestRunner, 'playwright', PlaywrightTestRunner),
];
