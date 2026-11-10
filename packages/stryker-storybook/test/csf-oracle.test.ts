import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { loadCsf, vitestTransform } from 'storybook/internal/csf-tools';

import { csfIgnorer } from '../src/csf-ignorer.ts';
import { isRecord } from '../src/is-record.ts';
import { instrument } from './support/instrument.ts';

const root = fileURLToPath(new URL('fixtures/csf-oracle/', import.meta.url));
const noMain = fileURLToPath(new URL('fixtures/no-main/', import.meta.url));
const configDir = `${noMain}.storybook`;
const fileName = `${noMain}src/Button.stories.tsx`;
const fixtures = [
  ...parseFixtures(JSON.parse(readFileSync(`${root}fixtures.json`, 'utf8'))),
  {
    name: 'own: template bind with a template that has mutants',
    code: "export default { title: 'foo/bar' };\nconst Template = (args) => <B {...args} />;\nexport const A = Template.bind({});\nA.args = { x: 1 };\n",
  },
];

function parseFixtures(
  value: unknown,
): readonly { readonly name: string; readonly code: string }[] {
  const list = isRecord(value) ? value['fixtures'] : undefined;

  if (!Array.isArray(list)) {
    throw new Error('fixtures.json has no fixtures list');
  }

  return list.map((fixture: unknown) => {
    const name = isRecord(fixture) ? fixture['name'] : undefined;
    const code = isRecord(fixture) ? fixture['code'] : undefined;

    if (typeof name !== 'string' || typeof code !== 'string') {
      throw new Error('fixtures.json holds a fixture without name or code');
    }

    return { name, code };
  });
}

function withoutPosition(error: unknown): string {
  return `throws ${String(error instanceof Error ? error.message : error).replaceAll(/\(line \d+, col \d+\)/g, '')}`;
}

function indexInputs(code: string): unknown {
  try {
    return loadCsf(code, {
      fileName,
      makeTitle: (title) => title ?? 'Default Title',
    }).parse().indexInputs;
  } catch (error) {
    return withoutPosition(error);
  }
}

async function storyTests(code: string): Promise<unknown> {
  try {
    const result = await vitestTransform({
      code,
      fileName,
      configDir,
      stories: [{ directory: '../src', files: '**/*.stories.tsx' }],
      tagsFilter: { include: ['test'], exclude: [], skip: [] },
      previewLevelTags: [],
    });
    const text = typeof result === 'string' ? result : result.code;

    return text.match(
      /_(test|describe)\("[^"]*"|(storyId|exportName): "[^"]*"|_describe\.skip/g,
    );
  } catch (error) {
    return withoutPosition(error);
  }
}

describe('lz-storybook-csf oracle: Storybook reads an instrumented story file as it reads the original', () => {
  const ignorer = csfIgnorer(
    { lzStorybook: { configDir }, lzStorybookCsf: { play: 'ignore' } },
    { info: () => undefined, warn: () => undefined },
  );

  fixtures.forEach(({ name, code }) => {
    it(name, async () => {
      const instrumented = (await instrument(fileName, code, [ignorer])).code;

      assert.deepEqual(
        {
          index: indexInputs(instrumented),
          tests: await storyTests(instrumented),
        },
        { index: indexInputs(code), tests: await storyTests(code) },
      );
    });
  });
});
