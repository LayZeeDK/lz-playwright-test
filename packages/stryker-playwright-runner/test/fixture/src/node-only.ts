// Only node.spec.ts imports this, never a page, so its module-level code runs only at import into a
// Playwright worker, outside any test.
export const loadedIn = 'a Playwright worker';

// Only a beforeAll hook in node.spec.ts calls this.
export function increment(n: number): number {
  return n + 1;
}

// Only a worker fixture in node.spec.ts calls this.
export function decrement(n: number): number {
  return n - 1;
}
