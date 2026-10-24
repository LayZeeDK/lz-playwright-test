import { defineConfig, devices } from '@playwright/test';

const galleryURL = 'http://localhost:4210/playwright/gallery/index.html';

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
    command: 'npx vite --port 4210 --strictPort',
    cwd: import.meta.dirname,
    url: galleryURL,
    reuseExistingServer: !process.env['CI'],
  },
});
