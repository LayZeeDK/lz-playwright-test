import { install, resolveFromCore } from './install.ts';
import { mutatorSets, type LzPlaywrightMutatorOptions } from './mutators.ts';
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
