import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './public',
  use: { ...devices['Desktop Chrome'] },
});
