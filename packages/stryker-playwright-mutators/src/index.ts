import { install, resolveFromCore } from './install.ts';
import { mutatorSets } from './mutators.ts';

/** This package has no opt-in or experimental mutators yet, so the options name none. */
export type LzPlaywrightMutatorOptions = Readonly<Record<string, never>>;

/**
 * Turns off Stryker's 17 built-in mutators and installs this package's mutators. A Stryker configuration file awaits
 * it, so that an error in the install stops the run.
 */
export async function lzPlaywrightMutators(
  options?: LzPlaywrightMutatorOptions,
): Promise<void> {
  await install(mutatorSets, options, resolveFromCore);
}
