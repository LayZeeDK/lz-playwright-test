import type { Ignorer } from '@stryker-mutator/api/ignore';
import { commonTokens, tokens } from '@stryker-mutator/api/plugin';

import { field } from './node-field.ts';
import { lzStorybookOptions } from './options.ts';
import {
  isStoryFile,
  storybookProject,
  type ProjectLog,
} from './storybook-project.ts';
import { reasonSites, spyStubReason, type ReasonSite } from './stub-verdict.ts';

export function stubIgnorer(options: object, log: ProjectLog): Ignorer {
  let sites: readonly ReasonSite[] = [];

  return {
    shouldIgnore(path) {
      const node = field(path, 'node');

      if (field(node, 'type') === 'Program') {
        const fileName = field(path, 'hub', 'file', 'opts', 'filename');
        const project = storybookProject(
          lzStorybookOptions(options).configDir,
          log,
        );
        sites =
          typeof fileName === 'string' && isStoryFile(project, fileName)
            ? reasonSites(node, project)
            : [];
      }

      const site = sites.find(
        ({ start, end }) =>
          field(node, 'start') === start && field(node, 'end') === end,
      );

      return site === undefined ? undefined : spyStubReason(site.verdict);
    },
  };
}

stubIgnorer.inject = tokens(commonTokens.options, commonTokens.logger);
