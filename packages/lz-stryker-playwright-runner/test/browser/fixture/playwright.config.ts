import { defineConfig, devices } from '@playwright/test';

const baseURL = 'http://127.0.0.1:4321';

export default defineConfig({
  testDir: './tests',
  expect: { timeout: 1_000 },
  use: { ...devices['Desktop Chrome'], baseURL },
  projects: [
    { name: 'e2e', testIgnore: /reuse/ },
    { name: 'reuse', testMatch: /reuse/, use: { reuseContext: true } },
  ],
  webServer: {
    command: 'node serve.ts',
    cwd: import.meta.dirname,
    url: baseURL,
    reuseExistingServer: false,
  },
});
