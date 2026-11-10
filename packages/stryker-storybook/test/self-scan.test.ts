import assert from 'node:assert/strict';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { selfScan } from '../src/self-scan.ts';
import { storybookProject } from '../src/storybook-project.ts';

const fixtures = fileURLToPath(new URL('fixtures/', import.meta.url));

describe('selfScan', () => {
  it('scans the story files that the Storybook main file lists', () => {
    const project = storybookProject(join(fixtures, 'scan', '.storybook'), {
      info: () => undefined,
      warn: () => undefined,
    });

    const scanned = selfScan(project, () => false);

    assert.deepEqual(
      scanned.map(({ fileName }) => fileName.split('/').slice(-2).join('/')),
      ['src/Listed.stories.tsx'],
    );
  });
});
