import { defineConfig, devices } from '@playwright/test';

const baseURL = 'http://127.0.0.1:4323';

export default defineConfig({
  testDir: './public',
  use: { ...devices['Desktop Chrome'], baseURL, actionTimeout: 2_000 },
  webServer: {
    command: 'node serve.ts',
    cwd: import.meta.dirname,
    url: baseURL,
    reuseExistingServer: false,
  },
});
