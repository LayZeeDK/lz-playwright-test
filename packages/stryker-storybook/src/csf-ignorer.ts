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

      if (field(node, 'type') === 'Program') {
        shapes = csfShapes(node);
      }

      if (
        field(options, 'lzStorybookCsf', 'play') !== 'mutate' &&
        shapes?.metaObjects.has(node)
      ) {
        return metaReason;
      }

      return field(path, 'key') === 'value' &&
        field(path, 'parentPath', 'node', 'key', 'name') === 'title'
        ? staticReason
        : undefined;
    },
  };
}

function field(value: unknown, ...keys: readonly string[]): unknown {
  return keys.reduce<unknown>(
    (found, key) => (isRecord(found) ? found[key] : undefined),
    value,
  );
}
