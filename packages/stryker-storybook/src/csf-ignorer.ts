import type { Ignorer } from '@stryker-mutator/api/ignore';

import { csfShapes, type CsfShapes } from './csf.ts';
import { isRecord } from './is-record.ts';
import { lzStorybookOptions } from './options.ts';
import { packageName } from './package-name.ts';
import {
  isStoryFile,
  storybookProject,
  type ProjectLog,
  type StorybookProject,
} from './storybook-project.ts';

const staticReason = `${packageName}: Storybook reads this CSF value without running the file, so it stays as written`;
const metaReason = `${packageName}: Storybook reads the meta object without running the file, so it stays an object literal`;
const storyReason = `${packageName}: Storybook reads this story without running the file, so it stays an object or a function`;
const testReason = `${packageName}: test code in a story file is mutated by the Stryker config with lzStorybookCsf.play set to mutate`;
const mswReason = `${packageName}: msw handlers in a story file are mutated by the Stryker config with lzStorybookCsf.play set to mutate`;

export function csfIgnorer(options: object, log: ProjectLog): Ignorer {
  let project: StorybookProject | undefined;
  let shapes: CsfShapes | undefined;

  return {
    shouldIgnore(path) {
      const fileName = field(path, 'hub', 'file', 'opts', 'filename');
      const node = field(path, 'node');

      project ??= storybookProject(lzStorybookOptions(options).configDir, log);

      if (typeof fileName !== 'string' || !isStoryFile(project, fileName)) {
        return undefined;
      }

      const ignoreMode = field(options, 'lzStorybookCsf', 'play') !== 'mutate';

      if (field(node, 'type') === 'Program') {
        shapes = csfShapes(node);

        if (ignoreMode) {
          shapes.storyContainers.forEach(keepStoryContainer);
        }
      }

      if (ignoreMode && shapes?.metaObjects.has(node)) {
        return metaReason;
      }

      if (ignoreMode && shapes?.testCode.has(node)) {
        return testReason;
      }

      if (ignoreMode && shapes?.mswValues.has(node)) {
        return mswReason;
      }

      return field(path, 'key') === 'value' &&
        field(path, 'parentPath', 'node', 'key', 'name') === 'title'
        ? staticReason
        : undefined;
    },
  };
}

// A Stryker ignorer skips a whole subtree; a next-line directive skips only the mutants on the container's first line.
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
