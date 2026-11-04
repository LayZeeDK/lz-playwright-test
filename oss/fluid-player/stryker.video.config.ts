import type { PartialStrykerOptions } from '@stryker-mutator/api/core';

// The video case: the player's playback, seek, volume, miniplayer, subtitle and timeline code, which the specs
// check through the <video> element's currentTime, paused, readyState and playbackRate.
export default {
  plugins: ['@layzee/stryker-playwright-runner'],
  testRunner: 'lz-playwright',
  lzPlaywright: {
    configFile: 'playwright.stryker.config.ts',
    survivorTraces: 'reports/lz-playwright-traces',
    traceScreenshots: true,
  },
  // Three playback modules the video specs drive; the 3,551-line player core and the ad code would take several
  // more hours of runs.
  mutate: ['src/modules/timeline.js', 'src/modules/miniplayer.js', 'src/modules/subtitles.js'],
  coverageAnalysis: 'perTest',
  timeoutMS: 20_000,
  dryRunTimeoutMinutes: 20,
  concurrency: 3,
  incremental: true,
  incrementalFile: 'reports/stryker-incremental.json',
  reporters: ['clear-text', 'progress', 'json', 'html', 'lz-playwright-traces'],
  jsonReporter: { fileName: 'reports/mutation/mutation.json' },
  htmlReporter: { fileName: 'reports/mutation/mutation.html' },
  ignorePatterns: ['/reports'],
  tempDirName: '.stryker-tmp',
} satisfies PartialStrykerOptions;
