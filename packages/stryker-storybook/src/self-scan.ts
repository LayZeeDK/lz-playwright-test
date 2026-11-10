import { readFileSync } from 'node:fs';

import { storyFilePaths, type StorybookProject } from './storybook-project.ts';
import { siteFindings, type SiteFinding } from './stub-findings.ts';

export interface ScannedStub extends SiteFinding {
  readonly fileName: string;
}

export function selfScan(
  project: StorybookProject,
  isReported: (fileName: string) => boolean,
  onUnparsable: (fileName: string, error: unknown) => void,
): readonly ScannedStub[] {
  return storyFilePaths(project)
    .filter((fileName) => /\.[cm]?[jt]sx?$/.test(fileName))
    .filter((fileName) => !isReported(fileName))
    .flatMap((fileName) =>
      siteFindings(
        readFileSync(fileName, 'utf8'),
        fileName,
        project,
        onUnparsable,
      ).map((finding) => ({ fileName, ...finding })),
    );
}
