import { defineConfig, devices } from '@playwright/test';

const baseURL = 'http://127.0.0.1:4324';

export default defineConfig({
  testDir: './tests',
  testMatch: /plain/,
  use: { ...devices['Desktop Chrome'], baseURL },
  webServer: {
    command: 'node serve.ts',
    cwd: import.meta.dirname,
    url: `${baseURL}/blank.html`,
    reuseExistingServer: false,
  },
});
