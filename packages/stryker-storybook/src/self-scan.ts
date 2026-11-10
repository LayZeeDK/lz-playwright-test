import { readFileSync } from 'node:fs';

import { storyFilePaths, type StorybookProject } from './storybook-project.ts';
import { parseStoryFile, silencedSites } from './stub-findings.ts';
import {
  describeVerdict,
  reasonSites,
  type SpyStubReason,
} from './stub-verdict.ts';

export interface ScannedStub extends SpyStubReason {
  readonly fileName: string;
  readonly line: number;
}

export function selfScan(
  project: StorybookProject,
  isReported: (fileName: string) => boolean,
  onUnparsable: (fileName: string, error: unknown) => void,
): readonly ScannedStub[] {
  return storyFilePaths(project)
    .filter((fileName) => /\.[cm]?[jt]sx?$/.test(fileName))
    .filter((fileName) => !isReported(fileName))
    .flatMap((fileName) => {
      const program = parseStoryFile(
        readFileSync(fileName, 'utf8'),
        fileName,
        onUnparsable,
      );

      if (program === undefined) {
        return [];
      }

      const sites = reasonSites(program, project);
      const silenced = silencedSites(program, sites);

      return sites
        .filter((site) => !silenced.has(site))
        .map(({ line, verdict }) => ({
          fileName,
          line,
          ...describeVerdict(verdict),
        }));
    });
}
