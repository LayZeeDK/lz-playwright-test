import { defineConfig, devices } from '@playwright/test';

const baseURL = 'http://localhost:4321';

export default defineConfig({
  testDir: './tests',
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
