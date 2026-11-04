import { declareClassPlugin, PluginKind } from '@stryker-mutator/api/plugin';

import { LzPlaywrightTestRunner } from './lz-playwright-test-runner.ts';
import { LzPlaywrightTracesReporter } from './traces-reporter.ts';

export { strykerValidationSchema } from './lz-playwright-runner-options-with-stryker-options.ts';

export const strykerPlugins = [
  declareClassPlugin(
    PluginKind.TestRunner,
    'lz-playwright',
    LzPlaywrightTestRunner,
  ),
  declareClassPlugin(
    PluginKind.Reporter,
    'lz-playwright-traces',
    LzPlaywrightTracesReporter,
  ),
];
