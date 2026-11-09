import { defineConfig } from '@playwright/test';

import config from './playwright.config.ts';

export default defineConfig(config, {
  testDir: './opt-in/public',
  retries: 1,
  failOnFlakyTests: true,
});
