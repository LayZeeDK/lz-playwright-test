// SPIKE_MODE=helpers gives every page Stryker's helper functions and SPIKE_ACTIVE as the active mutant, the way the
// runner's init script would; it then prints the coverage the page recorded.
import { readFileSync } from 'node:fs';

import { test as base } from '@playwright/test';

export { expect } from '@playwright/test';

const helpers = readFileSync(new URL('helpers.js', import.meta.url), 'utf8');

export const test = base.extend({
  context: async ({ context }, use) => {
    if (process.env['SPIKE_MODE'] === 'helpers') {
      const active = JSON.stringify(process.env['SPIKE_ACTIVE'] ?? null);
      await context.addInitScript({
        content: `globalThis.__stryker__ = { activeMutant: ${active} ?? undefined };\n${helpers}\nObject.assign(globalThis, { stryNS_9fa48, stryCov_9fa48, stryMutAct_9fa48 });`,
      });
    }

    await use(context);
  },
  page: async ({ page }, use) => {
    await use(page);
    const coverage = await page.evaluate(() =>
      JSON.stringify(
        (globalThis as { __stryker__?: { mutantCoverage?: unknown } })
          .__stryker__?.mutantCoverage ?? null,
      ),
    );
    console.log(`page coverage: ${coverage}`);
  },
});
