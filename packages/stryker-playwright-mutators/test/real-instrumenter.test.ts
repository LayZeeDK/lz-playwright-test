// Own file: node runs each test file in its own process, so the install changes this process's instrumenter only.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { lzPlaywrightMutators } from '../src/index.ts';
import { resolveFromCore } from '../src/install.ts';

const sample = `export function total(items: readonly number[], label: string, flag: boolean): string {
  let sum = 0;

  for (const item of items) {
    sum += item * 2;
  }

  if (flag && sum > 10) {
    console.log(label);
  }

  return \`\${label}: \${sum}\`.trim();
}
`;

describe('lzPlaywrightMutators', () => {
  it("makes the real instrumenter produce no mutant of a plain TypeScript file, as Stryker's 17 built-ins are off", async () => {
    const instrumenter = await resolveFromCore();
    const before = await instrumenter.instrument([
      { name: 'plain.ts', content: sample },
    ]);

    await lzPlaywrightMutators();

    const after = await instrumenter.instrument([
      { name: 'plain.ts', content: sample },
    ]);

    assert.equal(before.length > 0, true);
    assert.deepEqual(after, []);
  });
});
