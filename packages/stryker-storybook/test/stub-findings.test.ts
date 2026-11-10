import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { StorybookProject } from '../src/storybook-project.ts';
import { siteFindings } from '../src/stub-findings.ts';

function project(transformer: StorybookProject['transformer']) {
  return {
    configDir: '.storybook',
    storyFiles: 'fallback',
    transformer,
    previewTest: {},
  } satisfies StorybookProject;
}

describe('siteFindings', () => {
  it('gives a repaired stub inside a *Once stub no finding of its own', () => {
    const code = [
      "import { fn } from 'storybook/test';",
      'export default {',
      "  args: { g: fn().mockReturnValueOnce(fn().mockReturnValue('x')) },",
      '};',
      'export const Primary = {};',
    ].join('\n');

    const findings = siteFindings(
      code,
      'Meta.stories.tsx',
      project('seen'),
      () => undefined,
    );

    assert.deepEqual(
      findings.map(({ line, verdict }) => [line, verdict]),
      [[3, 'once-not-rewritten']],
    );
  });
});
