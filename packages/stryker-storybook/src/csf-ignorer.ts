import type { Ignorer } from '@stryker-mutator/api/ignore';
import { commonTokens, tokens } from '@stryker-mutator/api/plugin';

import { csfShapes } from './csf.ts';
import { isRecord } from './is-record.ts';
import { lzStorybookOptions } from './options.ts';
import { packageName } from './package-name.ts';
import {
  isStoryFile,
  storybookProject,
  type ProjectLog,
} from './storybook-project.ts';

const staticReason = `${packageName}: Storybook reads this CSF value without running the file, so it stays as written`;
const metaReason = `${packageName}: Storybook reads the meta object without running the file, so it stays an object literal`;
const storyReason = `${packageName}: Storybook reads this story without running the file, so it stays an object or a function`;
const testReason = `${packageName}: test code in a story file is mutated by the Stryker config with lzStorybookCsf.play set to mutate`;
const mswReason = `${packageName}: msw handlers in a story file are mutated by the Stryker config with lzStorybookCsf.play set to mutate`;

export function csfIgnorer(options: object, log: ProjectLog): Ignorer {
  const ignoreMode = field(options, 'lzStorybookCsf', 'play') !== 'mutate';
  let reasons: ReadonlyMap<unknown, string> = new Map();

  return {
    shouldIgnore(path) {
      const node = field(path, 'node');

      if (field(node, 'type') === 'Program') {
        const fileName = field(path, 'hub', 'file', 'opts', 'filename');
        const project = storybookProject(
          lzStorybookOptions(options).configDir,
          log,
        );
        reasons =
          typeof fileName === 'string' && isStoryFile(project, fileName)
            ? csfReasons(node, ignoreMode)
            : new Map();
      }

      return reasons.get(node);
    },
  };
}

csfIgnorer.inject = tokens(commonTokens.options, commonTokens.logger);

function csfReasons(
  program: unknown,
  ignoreMode: boolean,
): ReadonlyMap<unknown, string> {
  const shapes = csfShapes(program);
  const staticReasons = [...shapes.staticValues].map(
    (node) => [node, staticReason] as const,
  );

  if (!ignoreMode) {
    return new Map(staticReasons);
  }

  shapes.storyContainers.forEach(keepStoryContainer);

  // A later entry wins: meta over test code over msw over static values.
  return new Map([
    ...staticReasons,
    ...[...shapes.mswValues].map((node) => [node, mswReason] as const),
    ...[...shapes.testCode].map((node) => [node, testReason] as const),
    ...[...shapes.metaObjects].map((node) => [node, metaReason] as const),
  ]);
}

// A Stryker ignorer skips a whole subtree; a next-line directive skips only the mutants on the container's first line.
// StrykerJS reads a node's leading comments when it enters that node, after the ignorer has seen the Program node.
function keepStoryContainer(container: unknown): void {
  if (!isRecord(container)) {
    return;
  }

  container['leadingComments'] = [
    ...list(container['leadingComments']),
    {
      type: 'CommentLine',
      value: ` Stryker disable next-line ObjectLiteral,ArrowFunction: ${storyReason}`,
      loc: container['loc'],
    },
  ];
}

function list(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function field(value: unknown, ...keys: readonly string[]): unknown {
  return keys.reduce<unknown>(
    (found, key) => (isRecord(found) ? found[key] : undefined),
    value,
  );
}
