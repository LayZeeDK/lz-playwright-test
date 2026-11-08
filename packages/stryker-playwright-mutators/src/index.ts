import { install, resolveFromCore } from './install.ts';
import { mutatorSets, type LzPlaywrightMutatorOptions } from './mutators.ts';

export type { LzPlaywrightMutatorOptions } from './mutators.ts';

/**
 * Turns off Stryker's 17 built-in mutators and installs this package's mutators. A Stryker configuration file awaits
 * it, so that an error in the install stops the run.
 */
export async function lzPlaywrightMutators(
  options?: LzPlaywrightMutatorOptions,
): Promise<void> {
  await install(mutatorSets, options, resolveFromCore);
}
