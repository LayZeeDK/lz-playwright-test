import { defineConfig, devices } from '@playwright/test';

const baseURL = 'http://localhost:4322';

export default defineConfig({
  testDir: './tests',
  use: { ...devices['Desktop Chrome'], baseURL, actionTimeout: 2_000 },
  webServer: {
    command: 'node serve.ts',
    cwd: import.meta.dirname,
    url: baseURL,
    reuseExistingServer: false,
  },
});
