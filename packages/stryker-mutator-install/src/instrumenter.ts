// Reaches into @stryker-mutator/instrumenter's dist because its exports map exposes only `.` and `./package.json`.
import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { Ignorer } from '@stryker-mutator/api/ignore';

import { fieldOf, isRecord } from './is-record.ts';

const coreBin = /[\\/]@stryker-mutator[\\/]core[\\/]bin[\\/]stryker\.js$/;
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
  splice(
    start: number,
    deleteCount: number,
    ...mutators: ListedMutator[]
  ): ListedMutator[];
}

/** Babel's `NodePath` and `types.Node` in the instrumenter; this package does not depend on Babel. */
export interface ExpressionPlacerMethods {
  canPlace(path: unknown): boolean;
  place(path: unknown, appliedMutants: Map<unknown, unknown>): void;
}

export interface Instrumenter<TTypes> {
  readonly dir: string;
  readonly version: string;
  readonly types: TTypes;
  /** The array `transformBabel` reads by default on every file (`babel-transformer.js:8`). */
  readonly allMutators: MutatorList;
  /**
   * `target` is the first entry of the frozen `allMutantPlacers`; the array is frozen, this object is not
   * (`mutant-placers/index.js:6`).
   */
  readonly expressionPlacer: {
    readonly target: object;
    readonly original: ExpressionPlacerMethods;
  };
  instrument(files: readonly SourceFile[]): Promise<readonly MutantOrigin[]>;
}

export type AssertTypes<TTypes> = (
  value: unknown,
  missing: (name: string) => Error,
) => asserts value is TTypes;

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

/** `packageName` starts every error message, so the user sees which mutator package failed. */
export async function resolveInstrumenter<TTypes>(
  packageName: string,
  assertTypes: AssertTypes<TTypes>,
  corePackage: string,
): Promise<Instrumenter<TTypes>> {
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
  const missing = hasNo({ packageName, dir, version });

  if (!Array.isArray(allMutators) || !allMutators.every(isListedMutator)) {
    throw missing('allMutators');
  }

  if (!Array.isArray(allMutantPlacers)) {
    throw missing('allMutantPlacers');
  }

  const instrument = await coreInstrument({ packageName, dir, version });

  assertTypes(types, missing);

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

export interface Located {
  readonly packageName: string;
  readonly dir: string;
  readonly version: string;
}

function hasNo({
  packageName,
  dir,
  version,
}: Located): (name: string) => Error {
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
