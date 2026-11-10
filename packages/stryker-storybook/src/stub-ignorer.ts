import type { Ignorer } from '@stryker-mutator/api/ignore';

import { isRecord } from './is-record.ts';
import { lzStorybookOptions } from './options.ts';
import {
  isStoryFile,
  storybookProject,
  type ProjectLog,
} from './storybook-project.ts';
import { reasonSites, spyStubReason } from './stub-verdict.ts';

export function stubIgnorer(options: object, log: ProjectLog): Ignorer {
  let reasons: ReadonlyMap<number, string> = new Map();

  return {
    shouldIgnore(path) {
      const node = field(path, 'node');
      const start = field(node, 'start');

      if (field(node, 'type') === 'Program') {
        const fileName = field(path, 'hub', 'file', 'opts', 'filename');
        const project = storybookProject(
          lzStorybookOptions(options).configDir,
          log,
        );
        reasons = new Map(
          typeof fileName === 'string' && isStoryFile(project, fileName)
            ? reasonSites(node, project).map(({ start, verdict }) => [
                start,
                spyStubReason(verdict),
              ])
            : [],
        );
      }

      return typeof start === 'number' ? reasons.get(start) : undefined;
    },
  };
}

function field(value: unknown, ...keys: readonly string[]): unknown {
  return keys.reduce<unknown>(
    (found, key) => (isRecord(found) ? found[key] : undefined),
    value,
  );
}
