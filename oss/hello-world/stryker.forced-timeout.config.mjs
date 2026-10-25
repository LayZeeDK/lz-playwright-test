// Forces Stryker's own timeout to fire before Playwright's per-test timeout (floor 2000 ms).
export default {
  plugins: ['@spr/stryker-playwright-runner'],
  testRunner: 'playwright',
  mutate: ['src/**/*.js'],
  coverageAnalysis: 'perTest',
  timeoutMS: 1,
  timeoutFactor: 0,
  concurrency: 1,
  reporters: ['clear-text'],
  tempDirName: '.stryker-tmp-forced',
};
