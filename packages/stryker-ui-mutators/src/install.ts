// Reaches into @stryker-mutator/instrumenter's dist because its exports map exposes only `.` and `./package.json`.
import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { Mutant } from '@stryker-mutator/api/core';

import {
  toNodeMutator,
  type BabelTypes,
  type NodeMutatorLike,
  type Operator,
} from './mutator.ts';
import { withJsxPlacement, type MutantPlacerLike } from './placer.ts';

export const TESTED_VERSION = '10.1.1';
const CORE_BIN = /[\\/]@stryker-mutator[\\/]core[\\/]bin[\\/]stryker\.js$/;
const NAME = /^[A-Za-z]+$/;
// `Symbol.for`, so a second copy of this package in the process sees the marks of the first.
const OWN: unique symbol = Symbol.for('@layzee/stryker-ui-mutators');
const nothing = (): undefined => undefined;
const SILENT = {
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

export type InstrumentedMutant = Pick<
  Mutant,
  'id' | 'fileName' | 'mutatorName' | 'replacement' | 'location' | 'status'
>;

export interface InstrumentResult {
  readonly files: readonly SourceFile[];
  readonly mutants: readonly InstrumentedMutant[];
}

export interface Instrumenter {
  readonly dir: string;
  readonly version: string;
  readonly types: BabelTypes;
  /** The array `transformBabel` reads by default on every file (`babel-transformer.js:8`). */
  readonly allMutators: NodeMutatorLike[];
  /** First entry of the frozen `allMutantPlacers`; the array is frozen, this object is not (`mutant-placers/index.js:6`). */
  readonly expressionPlacer: MutantPlacerLike;
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

  if (instrumenter.version !== TESTED_VERSION) {
    warn(
      `stryker-ui-mutators was tested with @stryker-mutator/instrumenter ${TESTED_VERSION}, not ` +
        `${instrumenter.version} in ${instrumenter.dir}; its self-check passed.`,
    );
  }
}

function checkNames(
  operators: readonly Operator[],
  present: readonly NodeMutatorLike[],
): void {
  const names = operators.map(({ name }) => name);
  const invalid = names.filter((name) => !NAME.test(name));

  if (invalid.length > 0) {
    throw new Error(
      "stryker-ui-mutators: a mutator name has letters only, as Stryker's directives match no other character: " +
        invalid.map((name) => JSON.stringify(name)).join(', '),
    );
  }

  // Stryker's directives match mutator names ignoring case (directive-bookkeeper.ts:63, :73).
  const keys = names.map((name) => name.toLowerCase());
  const others = new Set(
    present
      .filter((mutator) => !(OWN in mutator))
      .map(({ name }) => name.toLowerCase()),
  );
  const taken = names.filter((name, index) => {
    const key = name.toLowerCase();

    return keys.indexOf(key) !== index || others.has(key);
  });

  if (taken.length > 0) {
    throw new Error(
      `stryker-ui-mutators: another mutator already has the name ${taken.join(', ')}.`,
    );
  }
}

function register(
  instrumenter: Instrumenter,
  operators: readonly Operator[],
): void {
  const { allMutators, expressionPlacer, types } = instrumenter;
  const registered = new Set(
    // Stryker disable next-line MethodExpression: equivalent, as checkNames has thrown for any operator whose name an unmarked mutator has
    allMutators.filter((mutator) => OWN in mutator).map(({ name }) => name),
  );

  allMutators.push(
    ...operators
      .filter(({ name }) => !registered.has(name))
      .map((operator) => ({ ...toNodeMutator(operator, types), [OWN]: OWN })),
  );

  if (!(OWN in expressionPlacer)) {
    Object.assign(expressionPlacer, withJsxPlacement(expressionPlacer, types), {
      [OWN]: OWN,
    });
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
  const made = new Set(
    mutants.map(({ fileName, mutatorName }) => `${fileName}\n${mutatorName}`),
  );
  const silent = operators
    .map(({ name }) => name)
    .filter((name) => !made.has(`${fileOf(name)}\n${name}`));

  if (silent.length > 0) {
    throw new Error(
      `stryker-ui-mutators: the instrumenter ${instrumenter.version} in ${instrumenter.dir} made no mutants of ` +
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

  return bin !== undefined && CORE_BIN.test(bin)
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
  const version = String(fromCore(packageJson).version);
  // `import()` types each namespace as `any`; these checks are what this module relies on in each one.
  const [{ allMutators }, { allMutantPlacers }, { Instrumenter }, { types }] =
    await Promise.all([
      importFile(join(dir, 'dist', 'src', 'mutators', 'mutate.js')),
      importFile(join(dir, 'dist', 'src', 'mutant-placers', 'index.js')),
      importFile(join(dir, 'dist', 'src', 'index.js')),
      importFile(createRequire(packageJson).resolve('@babel/core')),
    ]);
  const missing = (name: string): Error =>
    new Error(
      `stryker-ui-mutators: the instrumenter ${version} in ${dir} has no ${name}.`,
    );

  if (!Array.isArray(allMutators)) {
    throw missing('allMutators');
  }

  if (!Array.isArray(allMutantPlacers)) {
    throw missing('allMutantPlacers');
  }

  if (typeof Instrumenter !== 'function') {
    throw missing('Instrumenter');
  }

  if (typeof types?.isJSXText !== 'function') {
    throw missing('Babel types');
  }

  const expressionPlacer = allMutantPlacers.find(
    ({ name }) => name === 'expressionMutantPlacer',
  );

  if (expressionPlacer === undefined) {
    throw missing('expressionMutantPlacer');
  }

  return {
    dir,
    version,
    types,
    allMutators,
    expressionPlacer,
    async instrument(files, excludedMutations = []) {
      return new Instrumenter(SILENT).instrument(
        files.map((file): SourceFile & { mutate: true } => ({
          ...file,
          mutate: true,
        })),
        { plugins: null, excludedMutations, ignorers: [] },
      );
    },
  };
}

function importFile(path: string) {
  return import(pathToFileURL(path).href);
}
