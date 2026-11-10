import { fileURLToPath } from 'node:url';

import { csfIgnorer } from '../../src/csf-ignorer.ts';
import { instrument } from './instrument.ts';

const configDir = fileURLToPath(
  new URL('../fixtures/no-main/.storybook', import.meta.url),
);
export const staticReason =
  'lz-storybook-csf: Storybook reads this CSF value without running the file, so it stays as written';
export const metaReason =
  'lz-storybook-csf: Storybook reads the meta object without running the file, so it stays an object literal';
export const containerReason =
  'lz-storybook-csf: Storybook reads this story, its parameters or its test options without running the file, so it stays an object or a function';
export const testReason =
  'lz-storybook-csf: test code in a story file is mutated by the Stryker config with lzStorybookCsf.play set to mutate';
export const mswReason =
  'lz-storybook-csf: msw handlers in a story file are mutated by the Stryker config with lzStorybookCsf.play set to mutate';

export function setup(play?: 'ignore' | 'mutate') {
  const ignorer = csfIgnorer(
    { lzStorybook: { configDir }, lzStorybookCsf: play ? { play } : {} },
    { info: () => undefined, warn: () => undefined },
  );

  return {
    outcomes: async (code: string, fileName = 'src/a.stories.tsx') =>
      (await instrument(fileName, code, [ignorer])).mutants.map(
        ({ mutatorName, line, ignoreReason }) =>
          `${line} ${mutatorName} ${ignoreReason ?? 'placed'}`,
      ),
    warnings: async (code: string) =>
      (await instrument('src/a.stories.tsx', code, [ignorer])).warnings,
  };
}
