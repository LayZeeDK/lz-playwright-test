import nx from '@nx/eslint-plugin';
import playwright from 'eslint-plugin-playwright';
import jsoncParser from 'jsonc-eslint-parser';

const playwrightRecommended = playwright.configs['flat/recommended'];

function raiseWarning(level) {
  if (level === 'warn' || level === 1) {
    return 'error';
  }

  if (Array.isArray(level)) {
    return [raiseWarning(level[0]), ...level.slice(1)];
  }

  return level;
}

const playwrightRecommendedAsErrors = Object.fromEntries(
  Object.entries(playwrightRecommended.rules).map(([rule, level]) => [
    rule,
    raiseWarning(level),
  ]),
);

function dependencyChecks(ignoredDependencies) {
  return [
    'error',
    {
      ignoredDependencies,
      ignoredFiles: [
        '{projectRoot}/test/**',
        '{projectRoot}/eslint.config.{js,cjs,mjs,ts,cts,mts}',
      ],
    },
  ];
}

export default [
  ...nx.configs['flat/base'],
  ...nx.configs['flat/typescript'],
  ...nx.configs['flat/javascript'],
  {
    ignores: [
      '**/dist',
      '**/out-tsc',
      '**/vite.config.*.timestamp*',
      '**/test-output',
      // Instrumented bundles that runner.test.ts and ui-mutators.test.ts write before each run.
      'packages/stryker-playwright-runner/test/*/public/*.js',
    ],
  },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    rules: {
      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependency: true,
          allow: ['^.*/eslint(\\.base)?\\.config\\.[cm]?[jt]s$'],
          depConstraints: [
            {
              sourceTag: 'type:lib',
              onlyDependOnLibsWithTags: ['type:lib'],
            },
            {
              sourceTag: 'type:app',
              onlyDependOnLibsWithTags: ['type:lib'],
            },
            {
              sourceTag: 'type:e2e',
              onlyDependOnLibsWithTags: ['type:app', 'type:lib'],
            },
          ],
        },
      ],
    },
  },
  {
    files: [
      '**/*.ts',
      '**/*.tsx',
      '**/*.cts',
      '**/*.mts',
      '**/*.js',
      '**/*.jsx',
      '**/*.cjs',
      '**/*.mjs',
    ],
    // Override or add rules here
    rules: {},
  },
  {
    files: ['**/*.spec.ts', '**/playwright*.config.{ts,mts}'],
    ...playwrightRecommended,
    rules: {
      ...playwrightRecommendedAsErrors,
      'playwright/no-commented-out-tests': 'error',
      'playwright/no-get-by-title': 'error',
      'playwright/no-raw-locators': 'error',
      'playwright/prefer-native-locators': 'error',
      'playwright/no-nth-methods': 'error',
      'playwright/no-action-timeout': 'error',
      'playwright/no-slowed-test': 'error',
      'playwright/require-to-pass-timeout': 'error',
      'playwright/prefer-comparison-matcher': 'error',
      'playwright/prefer-equality-matcher': 'error',
      'playwright/prefer-to-be': 'error',
      'playwright/prefer-to-contain': 'error',
      'playwright/prefer-lowercase-title': 'error',
      'playwright/no-template-literal-title': 'error',
      'playwright/no-test-return-statement': 'error',
      'playwright/no-export': 'error',
      'playwright/require-annotation-reason': 'error',
      'playwright/no-magic-timeouts': 'error',
      'playwright/missing-playwright-await': [
        'error',
        { includePageLocatorMethods: true },
      ],
    },
  },
  {
    files: ['packages/*/package.json'],
    languageOptions: { parser: jsoncParser },
    rules: {
      // Core is the plugin host, resolved at run time rather than imported.
      '@nx/dependency-checks': dependencyChecks(['@stryker-mutator/core']),
    },
  },
  {
    files: ['packages/stryker-ui-mutators/package.json'],
    rules: {
      // The operators import Babel for types only.
      '@nx/dependency-checks': dependencyChecks([
        '@stryker-mutator/core',
        '@babel/core',
      ]),
    },
  },
];
