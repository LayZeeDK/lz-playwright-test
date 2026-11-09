import { writeFileSync } from 'node:fs';

const [configDir, resultFile] = process.argv.slice(2);

if (configDir === undefined || resultFile === undefined) {
  throw new Error('Usage: load-storybook.child <configDir> <resultFile>');
}

writeFileSync(resultFile, JSON.stringify(await load(configDir)));

async function load(configDir: string): Promise<object> {
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

    return { kind: 'loaded', storyFiles };
  } catch (error) {
    const { MainFileMissingError } = await import(
      'storybook/internal/server-errors'
    );

    return error instanceof MainFileMissingError
      ? { kind: 'no-main' }
      : { kind: 'failed', error: String(error) };
  }
}
