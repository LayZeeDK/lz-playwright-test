import type { Ignorer } from '@stryker-mutator/api/ignore';
import { commonTokens, tokens } from '@stryker-mutator/api/plugin';

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
import { spyStubReason, type ReasonVerdict } from './stub-verdict.ts';

export function stubIgnorer(options: object, log: ProjectLog): Ignorer {
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
            ? siteReasons(node, project)
            : new Map();
      }

      return reasons.get(field(node, 'start'));
    },
  };
}

stubIgnorer.inject = tokens(commonTokens.options, commonTokens.logger);

function siteReasons(
  program: unknown,
  project: StorybookProject,
): ReadonlyMap<unknown, string> {
  return new Map(
    [...siteVerdicts(program, project)].map(([start, verdict]) => [
      start,
      spyStubReason(verdict),
    ]),
  );
}

export function siteVerdicts(
  program: unknown,
  project: StorybookProject,
): ReadonlyMap<number, ReasonVerdict> {
  const onceSites = new Set(
    definitionTimeStubs(program).flatMap(({ start, once }) =>
      once ? [start] : [],
    ),
  );

  return new Map(
    classifyStubs(program, project.previewTest).stubs.flatMap(
      ({ start, verdict }): readonly (readonly [number, ReasonVerdict])[] => {
        if (verdict === 'kept') {
          return [];
        }

        if (project.transformer === 'seen') {
          return onceSites.has(start) ? [[start, 'once-not-rewritten']] : [];
        }

        return [[start, verdict]];
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
