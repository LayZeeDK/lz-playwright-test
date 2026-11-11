import { defineConfig } from '@playwright/test';

import config from './playwright.config.ts';

// A server and port of its own: node --test runs this config's spec beside the one on playwright.config.ts, and
// defineConfig(config, { webServer }) would start the base server too, since it appends webServer entries.
const baseURL = 'http://127.0.0.1:4325';

export default defineConfig({
  ...config,
  testDir: './opt-in/public',
  retries: 1,
  failOnFlakyTests: true,
  use: { ...config.use, baseURL },
  webServer: {
    command: 'node serve.ts 4325',
    cwd: import.meta.dirname,
    url: baseURL,
    reuseExistingServer: false,
  },
});
