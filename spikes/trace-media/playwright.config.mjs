// Records one trace of media.spec.mjs, with screenshots when SHOTS=on. Usage: SHOTS=on npx playwright test -c <this file>
import { defineConfig } from '@playwright/test';

const shots = process.env.SHOTS === 'on';

export default defineConfig({
  testDir: '.',
  testMatch: 'media.spec.mjs',
  outputDir: `out/${shots ? 'shots' : 'noshots'}`,
  reporter: 'line',
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:4791',
    viewport: { width: 760, height: 260 },
    trace: { mode: 'on', screenshots: shots, snapshots: true },
  },
  webServer: { command: 'node server.mjs 4791', url: 'http://127.0.0.1:4791/page.html', reuseExistingServer: false },
});
