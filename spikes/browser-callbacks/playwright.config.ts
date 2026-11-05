import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: 'instrumented.spec.ts',
  workers: 1,
  reporter: 'line',
  use: { browserName: 'chromium' },
});
