// Only node.spec.ts imports this, never a page, so its module-level code runs only at import into a
// Playwright worker, outside any test.
export const loadedIn = 'a Playwright worker';
