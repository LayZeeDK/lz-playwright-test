import { declareValuePlugin, PluginKind } from '@stryker-mutator/api/plugin';

import { install, resolveFromCore } from './install.ts';
import { mutatorSets, type LzPlaywrightMutatorOptions } from './mutators.ts';
import { serializedIgnorer } from './serialized-ignorer.ts';
import {
  parseSettings,
  useSettings,
  type LzPlaywrightMutatorSettings,
} from './settings.ts';

export type { LzPlaywrightMutatorOptions } from './mutators.ts';
export type { LzPlaywrightMutatorSettings } from './settings.ts';

/**
 * Turns off Stryker's 17 built-in mutators and installs this package's mutators. A Stryker configuration file awaits
 * it, so that an error in the install stops the run.
 *
 * `settings.navigationFixtures` lists the fixture names whose awaited call LzPlaywrightNavigationAction removes, in
 * place of `['navigate']`.
 */
export async function lzPlaywrightMutators(
  options?: LzPlaywrightMutatorOptions,
  settings?: LzPlaywrightMutatorSettings,
): Promise<void> {
  const parsed = parseSettings(settings);

  await install(mutatorSets, options, resolveFromCore);
  useSettings(parsed);
}

/**
 * The opt-in ignorer for functions that Playwright sends to another realm. Listing this package in `appendPlugins`
 * loads it and installs no mutator; `ignorers: ['lz-playwright-serialized']` turns it on.
 */
export const strykerPlugins = [
  declareValuePlugin(
    PluginKind.Ignore,
    'lz-playwright-serialized',
    serializedIgnorer,
  ),
];
