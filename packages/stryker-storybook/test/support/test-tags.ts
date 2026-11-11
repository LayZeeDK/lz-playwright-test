import { defaultTestTags, type TestTags } from '../../src/reset-setting.ts';

/** The default tag filter in a project whose preview declares no tags. */
export const untaggedPreviewTestTags: TestTags = {
  ...defaultTestTags,
  previewTags: [],
};

export function testTags(rule: Partial<TestTags>): TestTags {
  return { ...untaggedPreviewTestTags, ...rule };
}
