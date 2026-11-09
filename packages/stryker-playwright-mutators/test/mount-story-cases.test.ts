import { mountStoryCases } from './mount-story-cases.ts';
import { runCases } from './support/run-cases.ts';

runCases(
  mountStoryCases,
  { LzPlaywrightMountStory: true },
  '@playwright/experimental-ct-react',
);
