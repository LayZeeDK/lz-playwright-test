import { lzJsxMutators } from '@layzee/stryker-jsx-mutators';
import type { PartialStrykerOptions } from '@stryker-mutator/api/core';

await lzJsxMutators();

const webServerMutate = process.env['LZ_CORPUS_WEBSERVER_MUTATE'] ?? 'true';

if (webServerMutate !== 'true' && webServerMutate !== 'auto') {
  throw new Error(
    `LZ_CORPUS_WEBSERVER_MUTATE must be true or auto, got ${JSON.stringify(webServerMutate)}.`,
  );
}

export default {
  plugins: ['@layzee/stryker-playwright-runner'],
  testRunner: 'lz-playwright',
  lzPlaywright: {
    configFile: 'apps/examples/e2e/playwright.stryker.config.ts',
    survivorTraces: 'reports/lz-playwright-traces',
    traceScreenshots: true,
    webServer: { mutate: webServerMutate === 'auto' ? 'auto' : true },
  },
  // Workspace packages resolve through per-package node_modules links back to the copy's own source, so a
  // sandbox would serve unmutated code.
  inPlace: true,
  mutate: [
    'packages/commenting/src/canvas/thread-pin.tsx',
    'packages/commenting/src/canvas/thread-stack.tsx',
    'packages/commenting/src/ui/comment-composer.tsx',
    'packages/tldraw/src/lib/ui/components/primitives/menus/TldrawUiMenuItem.tsx',
    'packages/tldraw/src/lib/shapes/shared/RichTextLabel.tsx',
    'packages/tldraw/src/lib/ui/components/A11y.tsx',
    'packages/tldraw/src/lib/ui/components/Minimap/DefaultMinimap.tsx',
  ],
  // The JSX mutators only, so the run measures them on their own.
  mutator: {
    excludedMutations: [
      'ArithmeticOperator',
      'ArrayDeclaration',
      'ArrowFunction',
      'AssignmentOperator',
      'BlockStatement',
      'BooleanLiteral',
      'CallExpression',
      'ConditionalExpression',
      'EqualityOperator',
      'LogicalOperator',
      'MethodExpression',
      'ObjectLiteral',
      'OptionalChaining',
      'Regex',
      'StringLiteral',
      'UnaryOperator',
      'UpdateOperator',
    ],
  },
  coverageAnalysis: 'perTest',
  timeoutMS: 20_000,
  dryRunTimeoutMinutes: 20,
  concurrency: 2,
  incremental: true,
  incrementalFile: 'reports/stryker-incremental.json',
  reporters: ['clear-text', 'progress', 'json', 'html', 'lz-playwright-traces'],
  jsonReporter: { fileName: 'reports/mutation/mutation.json' },
  htmlReporter: { fileName: 'reports/mutation/mutation.html' },
  ignorePatterns: ['/reports'],
  tempDirName: '.stryker-tmp',
} satisfies PartialStrykerOptions;
