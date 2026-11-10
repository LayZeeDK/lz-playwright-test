import { join } from 'node:path';

export async function experimental_loadStorybook() {
  return { presets: { apply: async (_name, value) => value } };
}

export async function getStoriesPathsFromConfig({ configDir }) {
  return [join(configDir, '..', 'src', 'Picked.ts')];
}
