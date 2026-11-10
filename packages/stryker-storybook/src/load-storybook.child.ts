import { writeFileSync } from 'node:fs';
import { register } from 'node:module';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { isRecord } from './is-record.ts';
import type {
  LoaderResult,
  LoaderTestTags,
  LoadResult,
} from './loader-result.ts';
import { field } from './node-field.ts';

const [configDir, resultFile, vitestConfigFile] = process.argv.slice(2);

if (configDir === undefined || resultFile === undefined) {
  throw new Error(
    'Usage: load-storybook.child <configDir> <resultFile> [vitestConfigFile]',
  );
}

const projectFirstResolve = `
let child;
let project;

export function initialize(data) {
  ({ child, project } = data);
}

export async function resolve(specifier, context, nextResolve) {
  if (context.parentURL === child) {
    try {
      return await nextResolve(specifier, { ...context, parentURL: project });
    } catch {
      // Without parentURL here, Node resolves from the failed attempt's parentURL again.
      return nextResolve(specifier, { ...context, parentURL: child });
    }
  }

  return nextResolve(specifier, context);
}
`;

const projectDir = resolve(configDir, '..');

register(`data:text/javascript,${encodeURIComponent(projectFirstResolve)}`, {
  data: {
    child: import.meta.url,
    project: pathToFileURL(join(projectDir, 'package.json')).href,
  },
});

const storybook = await load(configDir, projectDir);
const result: LoaderResult = {
  ...storybook,
  testTags: await testTags(
    vitestConfigFile,
    storybook.kind === 'loaded' ? storybook.storyFiles : [],
  ),
};

writeFileSync(resultFile, JSON.stringify(result));

/** Storybook 10.6.5 addon-vitest: storybookTest() puts the tag filter in its project's test.env (vitest-plugin/index.ts 424-426). */
async function testTags(
  configFile: string | undefined,
  storyFiles: readonly string[],
): Promise<LoaderTestTags> {
  // Only the Vitest CLI sets VITEST, and storybookTest() returns no plugins without it.
  process.env['VITEST'] = 'true';
  process.env['STORYBOOK_DISABLE_TELEMETRY'] = '1';

  try {
    const vitestNode = await import('vitest/node').catch((error: unknown) => {
      if (isMissingModule(error)) {
        return undefined;
      }

      throw error;
    });

    if (vitestNode === undefined) {
      return { kind: 'no-vitest' };
    }

    const vitest = await vitestNode.createVitest('test', {
      config: configFile,
      watch: false,
    });

    try {
      // Storybook 10.6.5 addon-vitest vitest-manager.ts 612 finds its projects by this key.
      const storybookProjects = vitest.projects.filter(
        (project) =>
          field(project.config.env, '__STORYBOOK_URL__') !== undefined,
      );
      const env: unknown = (
        storybookProjects.find((project) =>
          storyFiles.some((file) => project.matchesTestGlob(file)),
        ) ?? storybookProjects[0]
      )?.config.env;

      return {
        kind: 'resolved',
        include: field(env, '__VITEST_INCLUDE_TAGS__'),
        exclude: field(env, '__VITEST_EXCLUDE_TAGS__'),
        skip: field(env, '__VITEST_SKIP_TAGS__'),
      };
    } finally {
      await vitest.close();
    }
  } catch (error) {
    return { kind: 'failed', error: withoutStack(error) };
  }
}

function isMissingModule(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    error.code === 'ERR_MODULE_NOT_FOUND'
  );
}

function withoutStack(error: unknown): string {
  return String(error)
    .split('\n')
    .filter((line) => !/^\s+at /.test(line))
    .join('\n');
}

async function load(
  configDir: string,
  projectDir: string,
): Promise<LoadResult> {
  try {
    const { experimental_loadStorybook, getStoriesPathsFromConfig } =
      await import('storybook/internal/core-server');
    const { presets } = await experimental_loadStorybook({
      configDir,
      packageJson: {},
    });
    const storyFiles = await getStoriesPathsFromConfig({
      stories: await presets.apply('stories', []),
      configDir,
      workingDir: process.cwd(),
    });
    const viteConfig: unknown = await presets.apply('viteFinal', {
      root: projectDir,
    });
    const plugins =
      isRecord(viteConfig) && Array.isArray(viteConfig['plugins'])
        ? viteConfig['plugins'].flat(Infinity)
        : [];
    const pluginNames = plugins.flatMap((plugin: unknown) =>
      isRecord(plugin) && typeof plugin['name'] === 'string'
        ? [plugin['name']]
        : [],
    );

    return { kind: 'loaded', storyFiles, pluginNames };
  } catch (error) {
    const { MainFileMissingError } = await import(
      'storybook/internal/server-errors'
    );

    return error instanceof MainFileMissingError
      ? { kind: 'no-main' }
      : { kind: 'failed', error: withoutStack(error) };
  }
}
