import { existsSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import type { Plugin, UserConfig } from 'vite';

export function lzStorybookStrykerPlugin(): Plugin {
  return { name: 'lz-storybook-stryker', config: sandboxConfig };
}

/**
 * In Stryker's sandbox, `node_modules` links to the project's. Vitest resolves a setup file such as Storybook's
 * through that link to its real path, which `server.fs.allow` refuses, so a Stryker worker allows the real folders.
 * A plugin's list replaces Vite's default, the workspace root, so the workspace root stays in it.
 */
export async function sandboxConfig(
  config: UserConfig,
): Promise<UserConfig | undefined> {
  if (process.env['STRYKER_MUTATOR_WORKER'] === undefined) {
    return undefined;
  }

  const resolvedRoot = resolve(config.root ?? process.cwd());
  const root = config.resolve?.preserveSymlinks
    ? resolvedRoot
    : realpathSync(resolvedRoot);
  const { searchForWorkspaceRoot } = await import('vite');
  const workspaceRoot = searchForWorkspaceRoot(root);
  const installed = foldersUpTo(root, workspaceRoot)
    .map((folder) => join(folder, 'node_modules'))
    .filter((nodeModules) => existsSync(nodeModules))
    .map((nodeModules) => realpathSync(nodeModules));

  return { server: { fs: { allow: [workspaceRoot, ...installed] } } };
}

// Vite's workspace root is the folder itself or one that dirname reaches from it.
function foldersUpTo(folder: string, top: string): string[] {
  return folder === top
    ? [folder]
    : [folder, ...foldersUpTo(dirname(folder), top)];
}
