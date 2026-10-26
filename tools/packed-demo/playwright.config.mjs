import { defineConfig, devices } from '@playwright/test';

const strykerWorker = process.env['STRYKER_MUTATOR_WORKER'];
const port = strykerWorker === undefined ? 4500 : 4600 + Number(strykerWorker);
const url = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './e2e',
  use: { baseURL: url },
  webServer: {
    command: `npx vite --host 127.0.0.1 --port ${port} --strictPort`,
    url,
    reuseExistingServer: false,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
