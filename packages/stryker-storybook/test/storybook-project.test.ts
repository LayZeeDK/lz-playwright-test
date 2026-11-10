import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { describe, it, type TestContext } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  isStoryFile,
  parseLoaderResult,
  storyFilePaths,
  storybookProject,
} from '../src/storybook-project.ts';

const fixtures = fileURLToPath(new URL('fixtures/', import.meta.url));

function setup(fixture: string, root = fixtures) {
  const lines: string[] = [];
  const log = {
    info: (message: string) => lines.push(`info: ${message}`),
    warn: (message: string) => lines.push(`warn: ${message}`),
  };
  const project = storybookProject(join(root, fixture, '.storybook'), log);

  return {
    lines,
    project,
    file: (...segments: readonly string[]) =>
      join(fixtures, fixture, ...segments),
  };
}

function freshSetup(t: TestContext, fixture: string) {
  const root = mkdtempSync(join(tmpdir(), 'lz-storybook-project-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  cpSync(join(fixtures, fixture), join(root, fixture), { recursive: true });
  cpSync(join(fixtures, 'framework'), join(root, 'framework'), {
    recursive: true,
  });

  return setup(fixture, root);
}

describe('storybookProject', () => {
  describe('with no main file in the config folder', () => {
    it('counts a *.stories.* file as a story file', () => {
      const { project, file } = setup('no-main');

      assert.equal(
        isStoryFile(project, file('src', 'Button.stories.tsx')),
        true,
      );
    });

    it('counts a *.story.* file as a story file', () => {
      const { project, file } = setup('no-main');

      assert.equal(isStoryFile(project, file('src', 'Button.story.ts')), true);
    });

    it('does not count a file without .stories. or .story. in its name', () => {
      const { project, file } = setup('no-main');

      assert.equal(isStoryFile(project, file('src', 'Button.tsx')), false);
    });

    it('names the config folder as an absolute path when given a relative one', () => {
      const { project } = setup('no-main');
      const relativeProject = storybookProject(
        relative(process.cwd(), project.configDir),
        { info: () => undefined, warn: () => undefined },
      );

      assert.equal(relativeProject.configDir, project.configDir);
    });

    it('says once that it uses the file names', (t) => {
      const { lines, project } = freshSetup(t, 'no-main');

      assert.deepEqual(lines, [
        `info: @layzee/stryker-storybook: no Storybook main file in ${project.configDir}; story files are the files named *.stories.* or *.story.*`,
      ]);
    });
  });

  it('gives the same project for the same config folder', () => {
    const { project } = setup('globs');

    assert.equal(setup('globs').project, project);
  });

  describe('with a preview file in the config folder', () => {
    it("reads the preview's parameters.test", () => {
      const { project } = setup('preview-off');

      assert.deepEqual(project.previewTest, { restoreMocks: false });
    });

    it("reads the preview's tags", () => {
      const { project } = setup('preview-tags');

      assert.deepEqual(project.testTags.previewTags, ['!test', 'smoke']);
    });
  });

  it('reads a preview it cannot parse as unreadable, with no tags', (t) => {
    const root = mkdtempSync(join(tmpdir(), 'lz-storybook-project-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    mkdirSync(join(root, '.storybook'));
    writeFileSync(join(root, '.storybook', 'preview.ts'), 'export const = ;\n');

    const project = storybookProject(join(root, '.storybook'), {
      info: () => undefined,
      warn: () => undefined,
    });

    assert.deepEqual(
      [project.previewTest, project.testTags.previewTags],
      [
        {
          mockReset: 'unreadable',
          clearMocks: 'unreadable',
          restoreMocks: 'unreadable',
        },
        [],
      ],
    );
  });

  it('reads a preview it cannot read as unreadable, with no tags', (t) => {
    const root = mkdtempSync(join(tmpdir(), 'lz-storybook-project-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    mkdirSync(join(root, '.storybook', 'preview.ts'), { recursive: true });

    const project = storybookProject(join(root, '.storybook'), {
      info: () => undefined,
      warn: () => undefined,
    });

    assert.deepEqual(
      [project.previewTest, project.testTags.previewTags],
      [
        {
          mockReset: 'unreadable',
          clearMocks: 'unreadable',
          restoreMocks: 'unreadable',
        },
        [],
      ],
    );
  });

  it('warns once, naming a preview it cannot parse and the error', (t) => {
    const root = mkdtempSync(join(tmpdir(), 'lz-storybook-project-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    mkdirSync(join(root, '.storybook'));
    const preview = join(root, '.storybook', 'preview.ts');
    writeFileSync(preview, 'export const = ;\n');
    const lines: string[] = [];

    storybookProject(join(root, '.storybook'), {
      info: () => undefined,
      warn: (message: string) => lines.push(message),
    });

    assert.equal(lines.length, 1);
    assert.ok(
      lines[0]?.startsWith(
        `@layzee/stryker-storybook: could not parse ${preview}, so its parameters.test is unknown and its tags are left out: SyntaxError: `,
      ),
      lines[0],
    );
  });

  describe('with a main file that lists story globs', () => {
    it('logs nothing', (t) => {
      const { lines } = freshSetup(t, 'globs');

      assert.deepEqual(lines, []);
    });

    it('counts a file the globs match as a story file', () => {
      const { project, file } = setup('globs');

      assert.equal(
        isStoryFile(project, file('src', 'Button.stories.tsx')),
        true,
      );
    });

    it('matches a path whose drive letter is lower case', () => {
      const { project, file } = setup('globs');
      const path = file('src', 'Button.stories.tsx');

      assert.equal(
        isStoryFile(project, path.charAt(0).toLowerCase() + path.slice(1)),
        true,
      );
    });

    it('does not see the mock transformer among other plugins', () => {
      const { project } = setup('globs');

      assert.equal(project.transformer, 'not-seen');
    });

    it("reads the preview's parameters.test", () => {
      const { project } = setup('globs');

      assert.deepEqual(project.previewTest, { clearMocks: true });
    });

    it('lists only the story files that the globs match', () => {
      const { project } = setup('scan');

      assert.deepEqual(
        storyFilePaths(project).map((fileName) =>
          fileName.split('/').slice(-2).join('/'),
        ),
        ['src/Listed.stories.tsx'],
      );
    });

    it('does not count a *.stories.* file outside the globs', () => {
      const { project, file } = setup('globs');

      assert.equal(
        isStoryFile(project, file('other', 'Outside.stories.tsx')),
        false,
      );
    });
  });

  describe('with the mock transformer in viteFinal', () => {
    it('sees the transformer', () => {
      const { project } = setup('transformer');

      assert.equal(project.transformer, 'seen');
    });

    it('sees the transformer inside nested plugin arrays', () => {
      const { project } = setup('transformer-nested');

      assert.equal(project.transformer, 'seen');
    });

    it('has no preview settings without a preview file', () => {
      const { project } = setup('transformer');

      assert.deepEqual(project.previewTest, {});
    });
  });

  describe('with a main.js file', () => {
    it('loads it like a main.ts file and logs nothing', (t) => {
      const { lines } = freshSetup(t, 'main-js');

      assert.deepEqual(lines, []);
    });

    it("reads a preview.js file's parameters.test", () => {
      const { project } = setup('main-js');

      assert.deepEqual(project.previewTest, { mockReset: true });
    });
  });

  describe('with a Storybook installed in the project', () => {
    it("loads the project's Storybook instead of the plugin's", () => {
      const { project, file } = setup('own-storybook');

      assert.equal(isStoryFile(project, file('src', 'Picked.ts')), true);
    });
  });

  describe('with a Vitest config that runs the stories', () => {
    function vitestSetup(fixture: string, configFile: string) {
      const lines: string[] = [];
      const project = storybookProject(
        join(fixtures, fixture, '.storybook'),
        {
          info: (message: string) => lines.push(`info: ${message}`),
          warn: (message: string) => lines.push(`warn: ${message}`),
        },
        join(fixtures, fixture, configFile),
      );

      return { lines, project };
    }

    it("reads the tag filter of the config's storybookTest plugin", () => {
      const { project } = vitestSetup('vitest-tags', 'vitest.config.ts');

      assert.deepEqual(
        [
          project.testTags.include,
          project.testTags.exclude,
          project.testTags.skip,
        ],
        [['test', 'smoke'], ['flaky'], ['slow']],
      );
    });

    it('reads an empty include as no include filter', () => {
      const { project } = vitestSetup(
        'vitest-tags',
        'vitest.empty-include.config.ts',
      );

      assert.deepEqual(project.testTags.include, []);
    });

    it('counts the stories tagged test and logs nothing when no project runs storybookTest', () => {
      const { lines, project } = vitestSetup(
        'vitest-tags',
        'vitest.plain.config.ts',
      );

      assert.deepEqual(
        [
          project.testTags.include,
          project.testTags.exclude,
          project.testTags.skip,
          lines,
        ],
        [['test'], [], [], []],
      );
    });

    it('counts the stories tagged test and warns once when a tag value is not a string', () => {
      const { lines, project } = vitestSetup(
        'vitest-tags',
        'vitest.odd-tags.config.mjs',
      );

      assert.deepEqual(
        [project.testTags.include, lines],
        [
          ['test'],
          [
            'warn: @layzee/stryker-storybook: the Storybook loader wrote a tag filter of an unknown shape, so the tested stories are the stories tagged test',
          ],
        ],
      );
    });

    it('reads the tag filter of the Storybook project in test.projects', () => {
      const { project } = vitestSetup(
        'vitest-tags',
        'vitest.projects.config.ts',
      );

      assert.deepEqual(
        [
          project.testTags.include,
          project.testTags.exclude,
          project.testTags.skip,
        ],
        [['test'], ['flaky'], []],
      );
    });

    it('reads the tag filter of the Storybook project that tests the story files', () => {
      const { project } = vitestSetup(
        'vitest-tags',
        'vitest.several.config.ts',
      );

      assert.deepEqual(project.testTags.exclude, ['flaky']);
    });

    it('reads the tag filter of the Storybook project when Storybook lists no story file', () => {
      const project = storybookProject(
        join(fixtures, 'no-main', '.storybook'),
        { info: () => undefined, warn: () => undefined },
        join(fixtures, 'vitest-tags', 'vitest.config.ts'),
      );

      assert.deepEqual(project.testTags.exclude, ['flaky']);
    });
  });

  describe('with a Vitest config that fails to load', () => {
    it('counts the stories tagged test and warns once, naming the config and the error', () => {
      const lines: string[] = [];
      const configFile = join(
        fixtures,
        'vitest-tags',
        'vitest.broken.config.ts',
      );

      const project = storybookProject(
        join(fixtures, 'vitest-tags', '.storybook'),
        {
          info: (message: string) => lines.push(`info: ${message}`),
          warn: (message: string) => lines.push(`warn: ${message}`),
        },
        configFile,
      );

      assert.deepEqual(
        [
          project.testTags.include,
          project.testTags.exclude,
          project.testTags.skip,
        ],
        [['test'], [], []],
      );
      assert.equal(lines.length, 1);
      assert.ok(
        lines[0]?.startsWith(
          `warn: @layzee/stryker-storybook: Vitest could not load ${configFile}, so the tested stories are the stories tagged test: `,
        ),
        lines[0],
      );
      assert.ok(
        lines[0]?.includes(
          'vitest.broken.config.ts of the vitest-tags fixture',
        ),
        lines[0],
      );
    });

    it('counts the stories tagged test and warns once when the config file is missing', () => {
      const lines: string[] = [];
      const configFile = join(
        fixtures,
        'vitest-tags',
        'vitest.missing.config.ts',
      );

      const project = storybookProject(
        join(fixtures, 'vitest-tags', '.storybook'),
        {
          info: (message: string) => lines.push(`info: ${message}`),
          warn: (message: string) => lines.push(`warn: ${message}`),
        },
        configFile,
      );

      assert.deepEqual(project.testTags.include, ['test']);
      assert.deepEqual(
        lines.map((line) => line.split(', so ')[0]),
        [
          `warn: @layzee/stryker-storybook: Vitest could not load ${configFile}`,
        ],
      );
    });
  });

  describe('without Vitest installed', () => {
    it('counts the stories tagged test and warns once that Vitest is not installed', (t) => {
      const nodeOptions = process.env['NODE_OPTIONS'];
      t.after(() => {
        process.env['NODE_OPTIONS'] = nodeOptions;
      });
      process.env['NODE_OPTIONS'] =
        `--import=${pathToFileURL(join(fixtures, 'no-vitest', 'register.mjs')).href}`;
      const lines: string[] = [];

      const project = storybookProject(
        join(fixtures, 'no-main', '.storybook'),
        {
          info: () => undefined,
          warn: (message: string) => lines.push(`warn: ${message}`),
        },
        join(fixtures, 'vitest-tags', 'vitest.plain.config.ts'),
      );

      assert.deepEqual(
        [project.testTags.include, lines],
        [
          ['test'],
          [
            'warn: @layzee/stryker-storybook: Vitest is not installed, so the tested stories are the stories tagged test',
          ],
        ],
      );
    });
  });

  describe('with a Vitest import that fails for another reason', () => {
    it('counts the stories tagged test and warns once, naming the config and the error', (t) => {
      const nodeOptions = process.env['NODE_OPTIONS'];
      t.after(() => {
        process.env['NODE_OPTIONS'] = nodeOptions;
      });
      process.env['NODE_OPTIONS'] =
        `--import=${pathToFileURL(join(fixtures, 'broken-vitest', 'register.mjs')).href}`;
      const lines: string[] = [];
      const configFile = join(
        fixtures,
        'vitest-tags',
        'vitest.plain.config.ts',
      );

      const project = storybookProject(
        join(fixtures, 'broken-vitest', '.storybook'),
        {
          info: () => undefined,
          warn: (message: string) => lines.push(`warn: ${message}`),
        },
        configFile,
      );

      assert.deepEqual(
        [project.testTags.include, lines],
        [
          ['test'],
          [
            `warn: @layzee/stryker-storybook: Vitest could not load ${configFile}, so the tested stories are the stories tagged test: Error: vitest/node of the broken-vitest fixture`,
          ],
        ],
      );
    });
  });

  describe('parseLoaderResult', () => {
    it('reads a tag filter of an unknown kind as unreadable', () => {
      const { vitestTags } = parseLoaderResult({
        kind: 'no-main',
        testTags: { kind: 'other' },
      });

      assert.deepEqual(vitestTags, { kind: 'unreadable' });
    });

    it('reads a failed tag filter without an error message as unreadable', () => {
      const { vitestTags } = parseLoaderResult({
        kind: 'no-main',
        testTags: { kind: 'failed' },
      });

      assert.deepEqual(vitestTags, { kind: 'unreadable' });
    });
  });

  describe('with a main file that fails to load', () => {
    it('counts a *.stories.* file as a story file', () => {
      const { project, file } = setup('failing');

      assert.equal(
        isStoryFile(project, file('src', 'Button.stories.tsx')),
        true,
      );
    });

    it('warns once, naming the folder and the error', (t) => {
      const { lines, project } = freshSetup(t, 'failing');

      assert.equal(lines.length, 1);
      assert.ok(
        lines[0]?.startsWith(
          `warn: @layzee/stryker-storybook: Storybook could not load ${project.configDir}, so story files are the files named *.stories.* or *.story.*: `,
        ),
        lines[0],
      );
      assert.ok(
        lines[0]?.includes('Error: main.ts of the failing fixture'),
        lines[0],
      );
    });

    it('leaves the stack trace out of the warning', (t) => {
      const { lines } = freshSetup(t, 'failing');

      assert.doesNotMatch(lines.join('\n'), /^\s+at /m);
    });
  });
});
