import { declareClassPlugin, PluginKind } from '@stryker-mutator/api/plugin';

import { LzStrykerPlaywrightTestRunner } from './playwright-test-runner.ts';

export { strykerValidationSchema } from './options.ts';

export const strykerPlugins = [
  declareClassPlugin(
    PluginKind.TestRunner,
    'lz-stryker-playwright',
    LzStrykerPlaywrightTestRunner,
  ),
];
