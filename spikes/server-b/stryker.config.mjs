// Spike B: mutants in the code a Playwright webServer runs, with the runner's server support prototype.
// Run from the repo root, after building the runner; see README.md. The switch LZ_PLAYWRIGHT_SERVER_TESTS
// (header, arrival or off) and SPIKE_B_WORKERS (Playwright workers, 1 by default) come from the environment.
import base from '../../stryker.base.ts';

const mode = process.env['LZ_PLAYWRIGHT_SERVER_TESTS'] ?? 'off';
const workers = Number(process.env['SPIKE_B_WORKERS'] ?? 1);

export default {
  ...base,
  appendPlugins: ['@layzee/stryker-playwright-runner'],
  testRunner: 'lz-playwright',
  lzPlaywright: {
    configFile: 'spikes/server-b/playwright.config.mjs',
    workers,
  },
  mutate: ['spikes/server-b/src/cart.mjs'],
  coverageAnalysis: 'perTest',
  timeoutMS: 11_000,
  tempDirName: '.stryker-tmp-server-b',
  // Stryker copies the project into the sandbox; the server never reads the reports.
  ignorePatterns: [...base.ignorePatterns, '/reports'],
  reporters: ['clear-text', 'progress', 'json'],
  jsonReporter: { fileName: `spikes/server-b/out/${mode}-w${workers}.json` },
};
