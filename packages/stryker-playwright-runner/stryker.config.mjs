import { packageConfig } from '../../stryker.package.ts';

const dir = 'packages/stryker-playwright-runner';

export default {
  ...packageConfig('stryker-playwright-runner'),
  mutate: [
    `${dir}/src/**/*.ts`,
    // addInitScript hands this file to the page as source text, where instrumented code would call a namespace
    // the page does not have.
    `!${dir}/src/page-helpers.ts`,
  ],
};
