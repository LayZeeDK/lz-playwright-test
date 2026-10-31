// Reaches into @stryker-mutator/instrumenter's dist because its exports map exposes only `.` and `./package.json`.
import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { MutantStatus, Position } from '@stryker-mutator/api/core';

import { fieldOf, isRecord } from './is-record.ts';
import {
  babelTypeMembers,
  toNodeMutator,
  type BabelTypes,
  type Operator,
} from './mutator.ts';
import { withJsxPlacement, type PlacerMethods } from './placer.ts';

export const testedVersion = '10.1.1';
const coreBin = /[\\/]@stryker-mutator[\\/]core[\\/]bin[\\/]stryker\.js$/;
const namePattern = /^[A-Za-z]+$/;
// `Symbol.for`, so a second copy of this package in the process sees the marks of the first.
const ownMark: unique symbol = Symbol.for('@layzee/lz-stryker-ui-mutators');
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

export interface InstrumentedMutant {
  readonly id: string;
  readonly fileName: string;
  readonly mutatorName: string;
  readonly replacement: string;
  readonly location: {
    readonly start: Readonly<Position>;
    readonly end: Readonly<Position>;
  };
  readonly status?: MutantStatus | undefined;
}

export interface InstrumentResult {
  readonly files: readonly SourceFile[];
  readonly mutants: readonly InstrumentedMutant[];
}

/** What this package reads of a mutator in Stryker's list; only Stryker calls `mutate`. */
export interface ListedMutator {
  readonly name: string;
  readonly mutate: (...args: readonly never[]) => unknown;
}

/** Stryker's own list: this package reads it and appends its operators, nothing more. */
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
   * (`mutant-placers/index.js:6`). `original` calls the methods `target` had when it was resolved.
   */
  readonly expressionPlacer: {
    readonly target: object;
    readonly original: PlacerMethods;
  };
  instrument(
    files: readonly SourceFile[],
    excludedMutations?: readonly string[],
  ): Promise<InstrumentResult>;
}

export async function install(
  operators: readonly Operator[],
  resolve: () => Promise<Instrumenter> = resolveFromCore,
  warn: (message: string) => void = console.warn,
): Promise<void> {
  const instrumenter = await resolve();

  checkNames(operators, instrumenter.allMutators);
  register(instrumenter, operators);
  await selfCheck(instrumenter, operators);

  if (instrumenter.version !== testedVersion) {
    warn(
      `lz-stryker-ui-mutators was tested with @stryker-mutator/instrumenter ${testedVersion}, not ` +
        `${instrumenter.version} in ${instrumenter.dir}; its self-check passed.`,
    );
  }
}

function checkNames(
  operators: readonly Operator[],
  present: readonly ListedMutator[],
): void {
  const names = operators.map(({ name }) => name);
  const invalid = names.filter((name) => !namePattern.test(name));

  if (invalid.length > 0) {
    throw new Error(
      "lz-stryker-ui-mutators: a mutator name has letters only, as Stryker's directives match no other character: " +
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
      `lz-stryker-ui-mutators: another mutator already has the name ${taken.join(', ')}.`,
    );
  }
}

function register(
  instrumenter: Instrumenter,
  operators: readonly Operator[],
): void {
  const { allMutators, expressionPlacer, types } = instrumenter;
  const registered = new Set(allMutators.map(({ name }) => name));

  allMutators.push(
    ...operators
      .filter(({ name }) => !registered.has(name))
      .map((operator) => ({
        ...toNodeMutator(operator, types),
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
  operators: readonly Operator[],
): Promise<void> {
  const fileOf = (name: string): string => `${name}.self-check.tsx`;
  const { mutants } = await instrumenter.instrument(
    operators.map(({ name, sample }) => ({
      name: fileOf(name),
      content: sample,
    })),
  );
  const silent = operators
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
      `lz-stryker-ui-mutators: the instrumenter ${instrumenter.version} in ${instrumenter.dir} made no mutants of ` +
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
  // These checks are what this module relies on in each namespace. The signatures of the Babel types and of each
  // mutator's mutate stay unchecked; the self-check in install() runs them.
  const [mutate, placers, index, babel] = await Promise.all([
    importFile(join(dir, 'dist', 'src', 'mutators', 'mutate.js')),
    importFile(join(dir, 'dist', 'src', 'mutant-placers', 'index.js')),
    importFile(join(dir, 'dist', 'src', 'index.js')),
    importFile(createRequire(packageJson).resolve('@babel/core')),
  ]);
  const allMutators = fieldOf(mutate, 'allMutators');
  const allMutantPlacers = fieldOf(placers, 'allMutantPlacers');
  const Instrumenter = fieldOf(index, 'Instrumenter');
  const types = fieldOf(babel, 'types');
  const missing = (name: string): Error =>
    new Error(
      `lz-stryker-ui-mutators: the instrumenter ${version} in ${dir} has no ${name}.`,
    );

  if (!Array.isArray(allMutators) || !allMutators.every(isListedMutator)) {
    throw missing('allMutators');
  }

  if (!Array.isArray(allMutantPlacers)) {
    throw missing('allMutantPlacers');
  }

  const instrument =
    typeof Instrumenter === 'function'
      ? fieldOf(Instrumenter.prototype, 'instrument')
      : undefined;

  if (typeof Instrumenter !== 'function' || typeof instrument !== 'function') {
    throw missing('Instrumenter');
  }

  assertBabelTypes(types, missing);

  const placer = allMutantPlacers
    .filter(isRecord)
    .find(({ name }) => name === 'expressionMutantPlacer');

  if (
    placer === undefined ||
    typeof placer.canPlace !== 'function' ||
    typeof placer.place !== 'function'
  ) {
    throw missing('expressionMutantPlacer');
  }

  const { canPlace, place } = placer;

  const changed = (what: string): Error =>
    new Error(
      `lz-stryker-ui-mutators: the instrumenter ${version} in ${dir} resolved Instrumenter.instrument() to a ` +
        `value whose ${what} is missing or of the wrong type.`,
    );

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
              `lz-stryker-ui-mutators: the instrumenter ${version} in ${dir} has an expressionMutantPlacer whose ` +
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
    async instrument(files, excludedMutations = []) {
      const created: unknown = Reflect.construct(Instrumenter, [silentLogger]);
      const result: unknown = await Reflect.apply(instrument, created, [
        files.map((file) => ({ ...file, mutate: true })),
        { plugins: null, excludedMutations, ignorers: [] },
      ]);

      return parseResult(result, changed);
    },
  };
}

function importFile(path: string): Promise<unknown> {
  return import(pathToFileURL(path).href);
}

function isListedMutator(value: unknown): value is ListedMutator {
  return (
    isRecord(value) &&
    typeof value.name === 'string' &&
    typeof value.mutate === 'function'
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

// Stryker's own list, annotated rather than `as const` so that a mutant of a status fails to compile.
const statuses: readonly MutantStatus[] = [
  'Killed',
  'Survived',
  'NoCoverage',
  'CompileError',
  'RuntimeError',
  'Timeout',
  'Ignored',
  'Pending',
];

function parseResult(
  value: unknown,
  changed: (what: string) => Error,
): InstrumentResult {
  const files = fieldOf(value, 'files');
  const mutants = fieldOf(value, 'mutants');

  if (!Array.isArray(files)) {
    throw changed('files');
  }

  if (!Array.isArray(mutants)) {
    throw changed('mutants');
  }

  return {
    files: files.map((file: unknown) => ({
      name: stringOf(fieldOf(file, 'name'), 'files[].name', changed),
      content: stringOf(fieldOf(file, 'content'), 'files[].content', changed),
    })),
    mutants: mutants.map((mutant: unknown) => parseMutant(mutant, changed)),
  };
}

function parseMutant(
  mutant: unknown,
  changed: (what: string) => Error,
): InstrumentedMutant {
  const field = (name: string): string =>
    stringOf(fieldOf(mutant, name), `mutants[].${name}`, changed);
  const location = fieldOf(mutant, 'location');
  const status = fieldOf(mutant, 'status');

  return {
    id: field('id'),
    fileName: field('fileName'),
    mutatorName: field('mutatorName'),
    replacement: field('replacement'),
    location: {
      start: positionOf(fieldOf(location, 'start'), 'start', changed),
      end: positionOf(fieldOf(location, 'end'), 'end', changed),
    },
    status: status === undefined ? undefined : statusOf(status, changed),
  };
}

function positionOf(
  value: unknown,
  name: string,
  changed: (what: string) => Error,
): Position {
  const numberOf = (key: string): number => {
    const found = fieldOf(value, key);

    if (typeof found !== 'number') {
      throw changed(`mutants[].location.${name}.${key}`);
    }

    return found;
  };

  return { line: numberOf('line'), column: numberOf('column') };
}

function statusOf(
  value: unknown,
  changed: (what: string) => Error,
): MutantStatus {
  const known = statuses.find((status) => status === value);

  if (known === undefined) {
    throw changed('mutants[].status');
  }

  return known;
}

function stringOf(
  value: unknown,
  what: string,
  changed: (what: string) => Error,
): string {
  if (typeof value !== 'string') {
    throw changed(what);
  }

  return value;
}
