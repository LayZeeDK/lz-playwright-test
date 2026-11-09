import assert from 'node:assert/strict';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { isStoryFile, storybookProject } from '../src/storybook-project.ts';

const fixtures = fileURLToPath(new URL('fixtures/', import.meta.url));

function setup(fixture: string) {
  const lines: string[] = [];
  const log = {
    info: (message: string) => lines.push(`info: ${message}`),
    warn: (message: string) => lines.push(`warn: ${message}`),
  };
  const project = storybookProject(join(fixtures, fixture, '.storybook'), log);

  return {
    lines,
    project,
    file: (...segments: readonly string[]) =>
      join(fixtures, fixture, ...segments),
  };
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

    it('says once that it uses the file names', () => {
      const { lines, project } = setup('no-main');

      assert.deepEqual(lines, [
        `info: @layzee/stryker-storybook: no Storybook main file in ${project.configDir}; story files are the files named *.stories.* or *.story.*`,
      ]);
    });
  });

  describe('with a main file that lists story globs', () => {
    it('logs nothing', () => {
      const { lines } = setup('globs');

      assert.deepEqual(lines, []);
    });

    it('counts a file the globs match as a story file', () => {
      const { project, file } = setup('globs');

      assert.equal(
        isStoryFile(project, file('src', 'Button.stories.tsx')),
        true,
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

  describe('with a main.js file', () => {
    it('loads it like a main.ts file and logs nothing', () => {
      const { lines } = setup('main-js');

      assert.deepEqual(lines, []);
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

    it('warns once, naming the folder and the error', () => {
      const { lines, project } = setup('failing');

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
  });
});
