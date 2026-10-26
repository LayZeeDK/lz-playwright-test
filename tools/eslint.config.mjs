import baseConfig from '../eslint.config.mjs';

export default [
  ...baseConfig,
  {
    files: ['bench-playwright-runs.ts'],
    rules: {
      // The benchmark times the runner's Playwright internals, which the package does not export.
      '@nx/enforce-module-boundaries': 'off',
    },
  },
];
