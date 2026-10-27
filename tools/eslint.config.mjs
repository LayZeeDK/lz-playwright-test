import baseConfig, { typeSafetyRules } from '../eslint.config.mjs';

export default [
  ...baseConfig,
  {
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: {
        // The project service finds only the nearest tsconfig.json; the tools belong to tsconfig.tools.json.
        project: ['../tsconfig.tools.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: typeSafetyRules,
  },
  {
    files: ['bench-playwright-runs.ts'],
    rules: {
      // The benchmark times the runner's Playwright internals, which the package does not export.
      '@nx/enforce-module-boundaries': 'off',
    },
  },
];
