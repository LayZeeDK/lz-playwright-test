import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { StorybookProject } from '../src/storybook-project.ts';
import { siteFindings } from '../src/stub-findings.ts';
import { untaggedPreviewTestTags } from './support/test-tags.ts';

function project(
  transformer: StorybookProject['transformer'],
  testTags = untaggedPreviewTestTags,
) {
  return {
    configDir: '.storybook',
    storyFiles: 'fallback',
    transformer,
    previewTest: {},
    testTags,
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

  [
    { comment: '//Stryker disable next-line all', lines: [] },
    { comment: '// see Stryker disable next-line all', lines: [4] },
  ].forEach(({ comment, lines }) => {
    it(`reads the comment "${comment}" as Stryker does`, () => {
      const code = [
        "import { fn } from 'storybook/test';",
        'export default {',
        `  ${comment}`,
        '  args: { g: fn().mockReturnValueOnce(1) },',
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
        findings.map(({ line }) => line),
        lines,
      );
    });
  });

  it("counts only the stories that the project's tag filter tests", () => {
    const code = [
      "import { fn } from 'storybook/test';",
      'export default { parameters: { test: { restoreMocks: false } } };',
      'export const A = { parameters: { test: { mockReset: true } } };',
      "export const B = { tags: ['smoke'], args: { g: fn().mockReturnValue(1) } };",
    ].join('\n');

    const findings = siteFindings(
      code,
      'Tags.stories.tsx',
      project('not-seen', { ...untaggedPreviewTestTags, include: ['smoke'] }),
      () => undefined,
    );

    assert.deepEqual(findings, []);
  });
});
