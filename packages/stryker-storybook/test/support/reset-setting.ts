import { parseProgram } from '../../src/parse.ts';
import {
  classifyStubs,
  type StoryFile,
  type StubVerdict,
} from '../../src/reset-setting.ts';
import { untaggedPreviewTestTags } from './test-tags.ts';

export function storyFile(code: string, fileName: string): StoryFile {
  return { program: parseProgram(code, fileName), code, fileName };
}

export function verdictsOf(
  source: string,
  testTags = untaggedPreviewTestTags,
): readonly StubVerdict[] {
  return classifyStubs(
    storyFile(
      `import { fn } from 'storybook/test';\n${source}`,
      'X.stories.ts',
    ),
    {},
    testTags,
  ).stubs.map(({ verdict }) => verdict);
}
