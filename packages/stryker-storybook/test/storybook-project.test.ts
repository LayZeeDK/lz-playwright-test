import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { describe, it, type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';

import { isStoryFile, storybookProject } from '../src/storybook-project.ts';

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
  });

  it('reads a preview it cannot parse as unreadable', (t) => {
    const root = mkdtempSync(join(tmpdir(), 'lz-storybook-project-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    mkdirSync(join(root, '.storybook'));
    writeFileSync(join(root, '.storybook', 'preview.ts'), 'export const = ;\n');

    const project = storybookProject(join(root, '.storybook'), {
      info: () => undefined,
      warn: () => undefined,
    });

    assert.equal(project.previewTest, 'unreadable');
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
