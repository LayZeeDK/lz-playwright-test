import type { NamedMutator } from './install.ts';
import { isRecord } from './is-record.ts';

/** The mutators a package installs: those that run unless a config leaves them out, and those a user turns on. */
export interface MutatorSets<TMutator extends NamedMutator> {
  readonly defaults: readonly TMutator[];
  readonly optIn: readonly TMutator[];
  readonly experimental: readonly TMutator[];
}

/**
 * The mutators a user turns on besides the defaults: every opt-in mutator with `extended`, or one by its name, and every
 * experimental mutator with `experimental`, or one by its name inside it. Only `true` turns one on; Stryker's
 * `mutator.excludedMutations` turns mutators off.
 */
export type MutatorOptions<
  TOptIn extends string,
  TExperimental extends string,
> = {
  readonly [TName in TOptIn]?: true;
} & {
  readonly extended?: true;
  readonly experimental?: true | { readonly [TName in TExperimental]?: true };
};

/**
 * The defaults and the mutators that `options` turns on, in the order of `sets`. Throws, starting with `packageName`,
 * on options it does not take, as a config file in JavaScript has no type check. `installName` is the install
 * function the user called.
 */
export function selectMutators<TMutator extends NamedMutator>(
  packageName: string,
  installName: string,
  sets: MutatorSets<TMutator>,
  options: unknown,
): readonly TMutator[] {
  if (
    options !== undefined &&
    (!isRecord(options) ||
      Array.isArray(options) ||
      Object.values(options).some((value) => value !== undefined))
  ) {
    throw new Error(
      `${packageName}: the package has no opt-in or experimental mutators yet, so ${installName}() takes no ` +
        'options. Turn a mutator off with mutator.excludedMutations.',
    );
  }

  return sets.defaults;
}
