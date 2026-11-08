import type {
  Instrumenter,
  InstrumenterLocation,
  ListedMutator,
  MutatorList,
} from './instrumenter.ts';

export interface NamedMutator {
  readonly name: string;
}

export interface SampledMutator extends NamedMutator {
  /** A source file in which the mutator makes at least one mutant. */
  readonly sample: string;
}

const namePattern = /^[A-Za-z]+$/;

/**
 * The mark on every entry a mutator package adds. `Symbol.for`, so a second copy of the package in the process
 * sees the marks of the first.
 */
export function markOf(packageName: string): symbol {
  return Symbol.for(packageName);
}

export function checkNames(
  packageName: string,
  mutators: readonly NamedMutator[],
  present: readonly ListedMutator[],
): void {
  const names = mutators.map(({ name }) => name);
  const invalid = names.filter((name) => !namePattern.test(name));

  if (invalid.length > 0) {
    throw new Error(
      `${packageName}: a mutator name has letters only, as Stryker's directives match no other character: ` +
        invalid.map((name) => JSON.stringify(name)).join(', '),
    );
  }

  // Stryker's directives match mutator names ignoring case (directive-bookkeeper.ts:63, :73).
  // Stryker disable next-line MethodExpression: names hold ASCII letters only, so upper-casing groups the same names
  const keyOf = (name: string): string => name.toLowerCase();
  const keys = names.map(keyOf);
  const ownMark = markOf(packageName);
  const others = new Set(
    present
      .filter((mutator) => !(ownMark in mutator))
      .map(({ name }) => keyOf(name)),
  );
  const taken = names.filter((name, index) => {
    const key = keyOf(name);

    return keys.indexOf(key) !== index || others.has(key);
  });

  if (taken.length > 0) {
    throw new Error(
      `${packageName}: another mutator already has the name ${taken.join(', ')}.`,
    );
  }
}

/** Appends each mutator whose name the list does not hold yet, marked as the package's own. */
export function register(
  packageName: string,
  allMutators: MutatorList,
  mutators: readonly ListedMutator[],
): void {
  const registered = new Set(allMutators.map(({ name }) => name));
  const ownMark = markOf(packageName);

  allMutators.push(
    ...mutators
      .filter(({ name }) => !registered.has(name))
      .map((mutator) => ({ ...mutator, [ownMark]: ownMark })),
  );
}

export async function selfCheck(
  packageName: string,
  instrumenter: InstrumenterLocation &
    Pick<Instrumenter<unknown>, 'instrument'>,
  mutators: readonly SampledMutator[],
): Promise<void> {
  const fileOf = (name: string): string => `${name}.self-check.tsx`;
  const mutants = await instrumenter.instrument(
    mutators.map(({ name, sample }) => ({
      name: fileOf(name),
      content: sample,
    })),
  );
  const silent = mutators
    .map(({ name }) => name)
    .filter(
      (name) =>
        !mutants.some(
          ({ fileName, mutatorName }) =>
            fileName === fileOf(name) && mutatorName === name,
        ),
    );

  if (silent.length > 0) {
    throw new Error(
      `${packageName}: the instrumenter ${instrumenter.version} in ${instrumenter.dir} made no mutants of ` +
        `${silent.join(', ')} from their samples, so it does not run the mutators this module added. A bundled or ` +
        'second copy of the instrumenter does that.',
    );
  }
}

export function warnUntested(
  packageName: string,
  testedVersion: string,
  instrumenter: InstrumenterLocation,
  warn: (message: string) => void,
): void {
  if (instrumenter.version !== testedVersion) {
    warn(
      `${packageName} was tested with @stryker-mutator/instrumenter ${testedVersion}, not ` +
        `${instrumenter.version} in ${instrumenter.dir}; its self-check passed.`,
    );
  }
}
