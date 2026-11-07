import {
  corePackageJson,
  resolveInstrumenter,
  type Instrumenter as CoreInstrumenter,
  type ListedMutator,
} from './instrumenter.ts';
import { fieldOf } from './is-record.ts';
import {
  babelTypeMembers,
  toNodeMutator,
  type BabelTypes,
  type Mutator,
} from './mutator.ts';
import { withJsxPlacement } from './placer.ts';
import { packageName } from './package-name.ts';

export {
  coreInstrument,
  corePackageJson,
  type MutantOrigin,
  type SourceFile,
} from './instrumenter.ts';

export type Instrumenter = CoreInstrumenter<BabelTypes>;

export const testedVersion = '10.1.1';
const namePattern = /^[A-Za-z]+$/;
// `Symbol.for`, so a second copy of this package in the process sees the marks of the first.
const ownMark: unique symbol = Symbol.for(packageName);

export async function install(
  mutators: readonly Mutator[],
  resolve: () => Promise<Instrumenter> = resolveFromCore,
  warn: (message: string) => void = console.warn,
): Promise<void> {
  const instrumenter = await resolve();

  checkNames(mutators, instrumenter.allMutators);
  register(instrumenter, mutators);
  await selfCheck(instrumenter, mutators);

  if (instrumenter.version !== testedVersion) {
    warn(
      `${packageName} was tested with @stryker-mutator/instrumenter ${testedVersion}, not ` +
        `${instrumenter.version} in ${instrumenter.dir}; its self-check passed.`,
    );
  }
}

function checkNames(
  mutators: readonly Mutator[],
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
  const keyOf = (name: string): string => name.toLowerCase();
  const keys = names.map(keyOf);
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

function register(
  instrumenter: Instrumenter,
  mutators: readonly Mutator[],
): void {
  const { allMutators, expressionPlacer, types } = instrumenter;
  const registered = new Set(allMutators.map(({ name }) => name));

  allMutators.push(
    ...mutators
      .filter(({ name }) => !registered.has(name))
      .map((mutator) => ({
        ...toNodeMutator(mutator, types),
        [ownMark]: ownMark,
      })),
  );

  if (!(ownMark in expressionPlacer.target)) {
    Object.assign(
      expressionPlacer.target,
      withJsxPlacement(expressionPlacer.original, types),
      { [ownMark]: ownMark },
    );
  }
}

async function selfCheck(
  instrumenter: Instrumenter,
  mutators: readonly Mutator[],
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

export async function resolveFromCore(
  corePackage: string = corePackageJson(),
): Promise<Instrumenter> {
  return resolveInstrumenter(assertBabelTypes, corePackage);
}

function assertBabelTypes(
  value: unknown,
  missing: (name: string) => Error,
): asserts value is BabelTypes {
  const absent = [
    ...babelTypeMembers.filter(
      (member) => typeof fieldOf(value, member) !== 'function',
    ),
    ...(typeof fieldOf(fieldOf(value, 'react'), 'buildChildren') === 'function'
      ? []
      : ['react.buildChildren']),
  ];

  if (absent.length > 0) {
    throw missing(`Babel types with ${absent.join(', ')}`);
  }
}
