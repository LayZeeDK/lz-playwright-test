import { inspect } from 'node:util';

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

type Tier = keyof MutatorSets<NamedMutator>;

const tiers: readonly Tier[] = ['defaults', 'optIn', 'experimental'];
const whereTiersGo: Record<Tier, string> = {
  defaults: 'it runs by default',
  optIn: 'it is opt-in, so it goes outside experimental',
  experimental: 'it is experimental, so it goes inside experimental',
};

type SelectableTier = Exclude<Tier, 'defaults'>;

const tierLabels: Record<SelectableTier, string> = {
  optIn: 'opt-in',
  experimental: 'experimental',
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
    sets.optIn.length === 0 &&
    sets.experimental.length === 0 &&
    options !== undefined &&
    (!isPlainObject(options) ||
      Object.values(options).some((value) => value !== undefined))
  ) {
    throw new Error(
      `${packageName}: the package has no opt-in or experimental mutators yet, so ${installName}() takes no ` +
        'options. Turn a mutator off with mutator.excludedMutations.',
    );
  }

  const tierOf = new Map(
    tiers.flatMap((tier) =>
      sets[tier].map(({ name }): [string, Tier] => [name, tier]),
    ),
  );
  const checkTier = (expected: SelectableTier, name: string): void => {
    const tier = tierOf.get(name);

    if (tier !== expected) {
      const hint =
        tier === undefined
          ? `the names are ${sets[expected].map((mutator) => mutator.name).join(', ') || 'none'}`
          : whereTiersGo[tier];

      throw new Error(
        `${packageName}: no ${tierLabels[expected]} mutator is named ${name}; ${hint}.`,
      );
    }
  };

  const onlyTrue = (key: string, value: unknown): void => {
    if (value !== true) {
      throw new Error(
        `${packageName}: ${key} takes only true, not ${inspect(value)}; Stryker's mutator.excludedMutations ` +
          'turns mutators off.',
      );
    }
  };

  if (options !== undefined && !isPlainObject(options)) {
    throw new Error(
      `${packageName}: the options must be a plain object, not ${inspect(options)}.`,
    );
  }

  for (const [key, value] of definedEntries(options)) {
    if (key === 'extended' && sets.optIn.length === 0) {
      throw new Error(
        `${packageName}: the package has no opt-in mutators yet, so ${installName}() takes no ` +
          'extended option.',
      );
    }

    if (key === 'experimental' && sets.experimental.length === 0) {
      throw new Error(
        `${packageName}: the package has no experimental mutators yet, so ${installName}() takes no ` +
          'experimental option.',
      );
    }

    if (key === 'experimental' && isPlainObject(value)) {
      for (const [name, member] of definedEntries(value)) {
        onlyTrue(`experimental.${name}`, member);
        checkTier('experimental', name);
      }
    } else {
      onlyTrue(key, value);

      if (key !== 'extended' && key !== 'experimental') {
        checkTier('optIn', key);
      }
    }
  }

  const extended = ownFieldOf(options, 'extended') === true;
  const experimental = ownFieldOf(options, 'experimental');

  return [
    ...sets.defaults,
    ...sets.optIn.filter(
      ({ name }) => extended || ownFieldOf(options, name) === true,
    ),
    ...sets.experimental.filter(
      ({ name }) =>
        experimental === true || ownFieldOf(experimental, name) === true,
    ),
  ];
}

function ownFieldOf(value: unknown, key: string): unknown {
  return isRecord(value) && Object.hasOwn(value, key) ? value[key] : undefined;
}

/** An object literal or an object without a prototype, so that every key it has is its own. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) {
    return false;
  }

  const prototype: unknown = Object.getPrototypeOf(value);

  return prototype === Object.prototype || prototype === null;
}

/** The entries of `value` that hold something: a key holding undefined counts as absent. */
function definedEntries(value: unknown): [string, unknown][] {
  return Object.entries(isRecord(value) ? value : {}).filter(
    ([, member]) => member !== undefined,
  );
}
