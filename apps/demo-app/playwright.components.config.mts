import { defineConfig, devices } from '@playwright/test';

// Each Stryker test runner process starts its own dev server, so each needs its own port.
const strykerWorker = process.env['STRYKER_MUTATOR_WORKER'];
const port = strykerWorker === undefined ? 4210 : 4500 + Number(strykerWorker);
const galleryURL = `http://localhost:${port}/playwright/gallery/index.html`;

export default defineConfig({
  testDir: './component-tests',
  fullyParallel: true,
  projects: [
    {
      name: 'components',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: galleryURL,
        serviceWorkers: 'block',
        reuseContext: true,
      },
    },
  ],
  webServer: {
    command: `npx vite --port ${port} --strictPort`,
    cwd: import.meta.dirname,
    url: galleryURL,
    reuseExistingServer: !process.env['CI'] && strykerWorker === undefined,
  },
});
