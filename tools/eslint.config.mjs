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
      // The benchmark and the matrix tool read internals of the runner and of ui-mutators that neither package exports.
      '@nx/enforce-module-boundaries': 'off',
    },
  },
];
