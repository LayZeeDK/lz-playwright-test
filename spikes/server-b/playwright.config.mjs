import { defineConfig, devices } from '@playwright/test';

// Each Stryker test runner process starts its own server on its own port.
const port = 4830 + Number(process.env['STRYKER_MUTATOR_WORKER'] ?? 0);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  expect: { timeout: 1_000 },
  use: { ...devices['Desktop Chrome'], baseURL },
  webServer: {
    command: 'node src/server.mjs',
    cwd: import.meta.dirname,
    url: `${baseURL}/health`,
    env: { PORT: String(port) },
    reuseExistingServer: false,
  },
});
