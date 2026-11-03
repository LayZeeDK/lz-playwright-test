// Reaches into @stryker-mutator/instrumenter's dist because its exports map exposes only `.` and `./package.json`.
import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { Ignorer } from '@stryker-mutator/api/ignore';

import { fieldOf, isRecord } from './is-record.ts';
import {
  babelTypeMembers,
  toNodeMutator,
  type BabelTypes,
  type Mutator,
} from './mutator.ts';
import { withJsxPlacement, type PlacerMethods } from './placer.ts';
import { packageName } from './package-name.ts';

export const testedVersion = '10.1.1';
const coreBin = /[\\/]@stryker-mutator[\\/]core[\\/]bin[\\/]stryker\.js$/;
const namePattern = /^[A-Za-z]+$/;
// `Symbol.for`, so a second copy of this package in the process sees the marks of the first.
const ownMark: unique symbol = Symbol.for(packageName);
const nothing = (): undefined => undefined;
const silentLogger = {
  debug: nothing,
  info: nothing,
  warn: nothing,
  error: nothing,
  trace: nothing,
  fatal: nothing,
  isDebugEnabled: () => false,
  isTraceEnabled: () => false,
};

export interface SourceFile {
  readonly name: string;
  readonly content: string;
}

export interface MutantOrigin {
  readonly fileName: string;
  readonly mutatorName: string;
}

export interface ListedMutator {
  readonly name: string;
  readonly mutate: (...args: readonly never[]) => unknown;
}

export interface MutatorList extends ReadonlyArray<ListedMutator> {
  push(...mutators: ListedMutator[]): number;
}

export interface Instrumenter {
  readonly dir: string;
  readonly version: string;
  readonly types: BabelTypes;
  /** The array `transformBabel` reads by default on every file (`babel-transformer.js:8`). */
  readonly allMutators: MutatorList;
  /**
   * `target` is the first entry of the frozen `allMutantPlacers`; the array is frozen, this object is not
   * (`mutant-placers/index.js:6`).
   */
  readonly expressionPlacer: {
    readonly target: object;
    readonly original: PlacerMethods;
  };
  instrument(files: readonly SourceFile[]): Promise<readonly MutantOrigin[]>;
}

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

export function corePackageJson(
  argv1: string | undefined = process.argv[1],
  realpath: (path: string) => string = realpathSync,
  resolveHere: (specifier: string) => string = createRequire(import.meta.url)
    .resolve,
): string {
  let bin: string | undefined;

  try {
    bin = argv1 === undefined ? undefined : realpath(argv1);
  } catch {
    // argv1 names no file on disk; fall back to the core this module resolves.
  }

  return bin !== undefined && coreBin.test(bin)
    ? join(bin, '..', '..', 'package.json')
    : resolveHere('@stryker-mutator/core/package.json');
}

export async function resolveFromCore(
  corePackage: string = corePackageJson(),
): Promise<Instrumenter> {
  const fromCore = createRequire(corePackage);
  const packageJson = fromCore.resolve(
    '@stryker-mutator/instrumenter/package.json',
  );
  const dir = dirname(packageJson);
  const manifest: unknown = fromCore(packageJson);
  const version = String(fieldOf(manifest, 'version'));
  const [mutate, placers, babel] = await Promise.all([
    importFile(join(dir, 'dist', 'src', 'mutators', 'mutate.js')),
    importFile(join(dir, 'dist', 'src', 'mutant-placers', 'index.js')),
    importFile(createRequire(packageJson).resolve('@babel/core')),
  ]);
  const allMutators = fieldOf(mutate, 'allMutators');
  const allMutantPlacers = fieldOf(placers, 'allMutantPlacers');
  const types = fieldOf(babel, 'types');
  const missing = hasNo({ dir, version });

  if (!Array.isArray(allMutators) || !allMutators.every(isListedMutator)) {
    throw missing('allMutators');
  }

  if (!Array.isArray(allMutantPlacers)) {
    throw missing('allMutantPlacers');
  }

  const instrument = await coreInstrument({ dir, version });

  assertBabelTypes(types, missing);

  const placer = allMutantPlacers
    .filter(isRecord)
    .find(({ name }) => name === 'expressionMutantPlacer');

  if (
    placer === undefined ||
    typeof placer['canPlace'] !== 'function' ||
    typeof placer['place'] !== 'function'
  ) {
    throw missing('expressionMutantPlacer');
  }

  const { canPlace, place } = placer;

  return {
    dir,
    version,
    types,
    allMutators,
    expressionPlacer: {
      target: placer,
      original: {
        canPlace(path) {
          const placeable: unknown = Reflect.apply(canPlace, placer, [path]);

          if (typeof placeable !== 'boolean') {
            throw new Error(
              `${packageName}: the instrumenter ${version} in ${dir} has an expressionMutantPlacer whose ` +
                `canPlace returned a ${typeof placeable}, not a boolean.`,
            );
          }

          return placeable;
        },
        place(path, appliedMutants) {
          Reflect.apply(place, placer, [path, appliedMutants]);
        },
      },
    },
    async instrument(files) {
      const mutants = fieldOf(await instrument(files), 'mutants');

      if (!Array.isArray(mutants) || !mutants.every(isMutantOrigin)) {
        throw new Error(
          `${packageName}: the instrumenter ${version} in ${dir} resolved Instrumenter.instrument() to a ` +
            'value whose mutants are missing or have no string fileName and mutatorName.',
        );
      }

      return mutants.map(({ fileName, mutatorName }) => ({
        fileName,
        mutatorName,
      }));
    },
  };
}

interface Located {
  readonly dir: string;
  readonly version: string;
}

function hasNo({ dir, version }: Located): (name: string) => Error {
  return (name) =>
    new Error(
      `${packageName}: the instrumenter ${version} in ${dir} has no ${name}.`,
    );
}

export async function coreInstrument(
  instrumenter: Located,
): Promise<
  (
    files: readonly SourceFile[],
    excludedMutations?: readonly string[],
    ignorers?: readonly Ignorer[],
  ) => Promise<unknown>
> {
  const Instrumenter = fieldOf(
    await importFile(join(instrumenter.dir, 'dist', 'src', 'index.js')),
    'Instrumenter',
  );
  const instrument =
    typeof Instrumenter === 'function'
      ? fieldOf(Instrumenter.prototype, 'instrument')
      : undefined;

  if (typeof Instrumenter !== 'function' || typeof instrument !== 'function') {
    throw hasNo(instrumenter)('Instrumenter');
  }

  return async (files, excludedMutations = [], ignorers = []) => {
    const result: unknown = await Reflect.apply(
      instrument,
      Reflect.construct(Instrumenter, [silentLogger]),
      [
        files.map((file) => ({ ...file, mutate: true })),
        { plugins: null, excludedMutations, ignorers },
      ],
    );

    return result;
  };
}

function isMutantOrigin(value: unknown): value is MutantOrigin {
  return (
    typeof fieldOf(value, 'fileName') === 'string' &&
    typeof fieldOf(value, 'mutatorName') === 'string'
  );
}

function importFile(path: string): Promise<unknown> {
  return import(pathToFileURL(path).href);
}

function isListedMutator(value: unknown): value is ListedMutator {
  return (
    isRecord(value) &&
    typeof value['name'] === 'string' &&
    typeof value['mutate'] === 'function'
  );
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
