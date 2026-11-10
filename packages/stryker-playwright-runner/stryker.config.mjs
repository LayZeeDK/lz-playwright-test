import { packageConfig } from '../../stryker.package.ts';

const dir = 'packages/stryker-playwright-runner';
// The hooks and what they import run inside the worker, page and server processes whose Stryker namespace they
// manage, so instrumenting them breaks that namespace; page-helpers.ts reaches the page through addInitScript.
const hookLoaded = [
  'is-record',
  'namespace',
  'page-helpers',
  'playwright-internals',
  'protocol',
  'server-hook',
  'server-protocol',
  'server-run-switch',
  'worker-hook',
];

export default {
  ...packageConfig('stryker-playwright-runner'),
  mutate: [
    `${dir}/src/**/*.ts`,
    ...hookLoaded.map((file) => `!${dir}/src/${file}.ts`),
  ],
};
