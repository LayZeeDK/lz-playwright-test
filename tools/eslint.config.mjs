import baseConfig, {
  readonlyRules,
  typeSafetyRules,
} from '../eslint.config.mjs';

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
    rules: { ...typeSafetyRules, ...readonlyRules },
  },
  {
    files: ['bench-playwright-runs.ts', 'playwright-roles-matrix.ts'],
    rules: {
      // The benchmark times the runner's Playwright internals, and the matrix tool cuts fixtures with ui-mutators'
      // role-table reader; neither package exports them.
      '@nx/enforce-module-boundaries': 'off',
    },
  },
];
