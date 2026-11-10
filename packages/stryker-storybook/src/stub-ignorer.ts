import type { Ignorer } from '@stryker-mutator/api/ignore';

import { isRecord } from './is-record.ts';
import { lzStorybookOptions } from './options.ts';
import { classifyStubs } from './reset-setting.ts';
import {
  isStoryFile,
  storybookProject,
  type ProjectLog,
  type StorybookProject,
} from './storybook-project.ts';
import { definitionTimeStubs } from './stub-shape.ts';
import { spyStubReason } from './stub-verdict.ts';

export function stubIgnorer(options: object, log: ProjectLog): Ignorer {
  let project: StorybookProject | undefined;
  let reasons: ReadonlyMap<unknown, string> = new Map();

  return {
    shouldIgnore(path) {
      const node = field(path, 'node');

      if (field(node, 'type') === 'Program') {
        const fileName = field(path, 'hub', 'file', 'opts', 'filename');

        project ??= storybookProject(
          lzStorybookOptions(options).configDir,
          log,
        );
        reasons =
          typeof fileName === 'string' && isStoryFile(project, fileName)
            ? siteReasons(node, project)
            : new Map();
      }

      return reasons.get(field(node, 'start'));
    },
  };
}

function siteReasons(
  program: unknown,
  project: StorybookProject,
): ReadonlyMap<unknown, string> {
  const onceSites = new Set(
    definitionTimeStubs(program).flatMap(({ start, once }) =>
      once ? [start] : [],
    ),
  );

  return new Map(
    classifyStubs(program, project.previewTest).stubs.flatMap(
      ({ start, verdict }) => {
        if (verdict === 'kept') {
          return [];
        }

        if (project.transformer === 'seen') {
          return onceSites.has(start)
            ? [[start, spyStubReason('once-not-rewritten')]]
            : [];
        }

        return [[start, spyStubReason(verdict)]];
      },
    ),
  );
}

function field(value: unknown, ...keys: readonly string[]): unknown {
  return keys.reduce<unknown>(
    (found, key) => (isRecord(found) ? found[key] : undefined),
    value,
  );
}
