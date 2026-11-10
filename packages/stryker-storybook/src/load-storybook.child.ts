import { writeFileSync } from 'node:fs';
import { register } from 'node:module';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { isRecord } from './is-record.ts';

const [configDir, resultFile] = process.argv.slice(2);

if (configDir === undefined || resultFile === undefined) {
  throw new Error('Usage: load-storybook.child <configDir> <resultFile>');
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

writeFileSync(resultFile, JSON.stringify(await load(configDir, projectDir)));

async function load(configDir: string, projectDir: string): Promise<object> {
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
      : {
          kind: 'failed',
          error: String(error)
            .split('\n')
            .filter((line) => !/^\s+at /.test(line))
            .join('\n'),
        };
  }
}
