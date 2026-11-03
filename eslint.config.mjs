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

/** Every enabled rule reports at error, including those a preset or plugin sets to warn. */
export function withWarningsAsErrors(configs) {
  return configs.map((config) =>
    config.rules
      ? {
          ...config,
          rules: Object.fromEntries(
            Object.entries(config.rules).map(([rule, level]) => [
              rule,
              raiseWarning(level),
            ]),
          ),
        }
      : config,
  );
}

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

const declaredType = ':matches(TSInterfaceDeclaration, TSTypeAliasDeclaration)';

export const typeSafetyRules = {
  '@typescript-eslint/no-explicit-any': 'error',
  '@typescript-eslint/switch-exhaustiveness-check': 'error',
  '@typescript-eslint/use-unknown-in-catch-callback-variable': 'error',
  '@typescript-eslint/no-unsafe-assignment': 'error',
  '@typescript-eslint/no-unsafe-member-access': 'error',
  '@typescript-eslint/no-unsafe-call': 'error',
  '@typescript-eslint/no-unsafe-return': 'error',
  '@typescript-eslint/no-unsafe-argument': 'error',
  '@typescript-eslint/consistent-type-assertions': [
    'error',
    { assertionStyle: 'never' },
  ],
  '@typescript-eslint/no-non-null-assertion': 'error',
  '@typescript-eslint/ban-ts-comment': [
    'error',
    {
      'ts-expect-error': true,
      'ts-ignore': true,
      'ts-nocheck': true,
      'ts-check': false,
    },
  ],
  'dot-notation': 'off',
  '@typescript-eslint/dot-notation': 'error',
  '@typescript-eslint/naming-convention': [
    'error',
    {
      selector: 'variable',
      format: ['camelCase', 'PascalCase'],
      custom: { regex: '^[A-Z][A-Z0-9]+$', match: false },
    },
    { selector: 'variable', modifiers: ['destructured'], format: null },
    {
      selector: 'typeParameter',
      format: ['PascalCase'],
      custom: { regex: '^T([A-Z][A-Za-z0-9]*)?$', match: true },
    },
  ],
  'no-restricted-syntax': [
    'error',
    {
      selector: `${declaredType} TSPropertySignature:not([readonly=true])`,
      message: 'Mark the member readonly.',
    },
    {
      selector: `${declaredType} TSPropertySignature :not(TSTypeOperator[operator='readonly']) > TSArrayType`,
      message: 'Use readonly T[] or ReadonlyArray<T>.',
    },
    {
      selector: `${declaredType} TSPropertySignature TSTypeReference[typeName.name='Array']`,
      message: 'Use readonly T[] or ReadonlyArray<T>.',
    },
    {
      selector:
        ':matches(PropertyDefinition, MethodDefinition, TSParameterProperty, AccessorProperty, TSAbstractPropertyDefinition, TSAbstractMethodDefinition)[accessibility="private"]',
      message: 'Use a # member instead of the private modifier.',
    },
  ],
};

export default withWarningsAsErrors([
  ...nx.configs['flat/base'],
  ...nx.configs['flat/typescript'],
  ...nx.configs['flat/javascript'],
  {
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
      reportUnusedInlineConfigs: 'error',
    },
  },
  {
    ignores: [
      '**/dist',
      '**/out-tsc',
      '**/vite.config.*.timestamp*',
      '**/test-output',
      // Instrumented bundles that runner.test.ts and ui-mutators.test.ts write before each run.
      'packages/stryker-playwright-runner/test/**/public/*.js',
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
    rules: {
      // Deprecated; their replacements, no-empty-object-type and no-global-assign, are on.
      '@typescript-eslint/no-empty-interface': 'off',
      'no-native-reassign': 'off',
    },
  },
  {
    files: ['packages/**/*.ts', 'packages/**/*.tsx'],
    ignores: ['packages/stryker-jsx-mutators/test/corpus/**'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: typeSafetyRules,
  },
  {
    files: ['**/*.spec.ts', '**/playwright*.config.{ts,mts}'],
    ...playwrightRecommended,
    rules: {
      ...playwrightRecommended.rules,
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
    files: ['packages/stryker-jsx-mutators/package.json'],
    rules: {
      // The mutators import Babel for types only.
      '@nx/dependency-checks': dependencyChecks([
        '@stryker-mutator/core',
        '@babel/core',
      ]),
    },
  },
]);
