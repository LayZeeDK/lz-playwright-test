// The one module that reaches into @stryker-mutator/instrumenter's dist (its exports map exposes only `.`), and the
// only writer of the state the install keeps: the marks on the live `allMutators` entries and on the expression
// placer. The marks use a global symbol, so a second copy of this package in the same process reads them too.
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

const TESTED_VERSION = '10.1.1';
const CORE_BIN = /[\\/]@stryker-mutator[\\/]core[\\/]bin[\\/]stryker\.js$/;
const NAME = /^[A-Za-z]+$/;
/** Marks what this package put into the instrumenter; `Symbol.for`, so every copy of the package sees one key. */
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

/** The instrumenter that core runs, with the two live objects the install changes. */
export interface Instrumenter {
  readonly dir: string;
  readonly version: string;
  /** Babel's types from the instrumenter's own @babel/core (8.x), to build the nodes it places. */
  readonly types: BabelTypes;
  /** The array `transformBabel` reads by default on every file (`babel-transformer.js:8`). */
  readonly allMutators: NodeMutatorLike[];
  /** First entry of the frozen `allMutantPlacers`; the array is frozen, this object is not (`mutant-placers/index.js:6`). */
  readonly expressionPlacer: MutantPlacerLike;
  /** Instruments with the live lists, as core does; `excludedMutations` as in Stryker's `mutator` option. */
  instrument(
    files: readonly SourceFile[],
    excludedMutations?: readonly string[],
  ): Promise<InstrumentResult>;
}

/**
 * Registers `operators` in the instrumenter core uses, makes JSX a placement site, and proves both with one sample
 * per operator. Throws, before changing anything, on a name that is not letters only or that equals another name
 * ignoring case; throws, naming every silent operator, when a sample gives no mutant of its operator. A second
 * install in the process (another copy of this package, or a test) adds no operator twice and wraps the placer once.
 * Warns, after the self-check passed, when the instrumenter is not the tested version.
 */
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

/** Letters only; no two equal ignoring case among `operators` and the mutators not marked as this package's. */
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
  const taken = names.filter(
    (_name, index) =>
      keys.indexOf(keys[index]!) !== index || others.has(keys[index]!),
  );

  if (taken.length > 0) {
    throw new Error(
      `stryker-ui-mutators: another mutator already has the name ${taken.join(', ')}.`,
    );
  }
}

/** Pushes each operator whose name no marked mutator has yet, and wraps the placer unless it is marked. */
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

/**
 * Instruments every sample through the live lists in one call, as `<name>.self-check.tsx`, and throws unless each
 * gives a mutant of its own operator in its own file. Names the instrumenter's dir and version in the error, since a
 * bundled or second instrumenter copy is the likely cause.
 */
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

/**
 * The package.json of the @stryker-mutator/core that runs this process: from `argv1` when its realpath is core's
 * `bin/stryker.js` (a global or differently hoisted Stryker), else the core this module resolves (Stryker's API).
 */
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
    // `node --eval` and the REPL run no script file.
  }

  return bin !== undefined && CORE_BIN.test(bin)
    ? join(bin, '..', '..', 'package.json')
    : resolveHere('@stryker-mutator/core/package.json');
}

interface InstrumenterModule {
  Instrumenter: new (logger: typeof SILENT) => {
    instrument(
      files: readonly (SourceFile & { mutate: true })[],
      options: {
        plugins: null;
        excludedMutations: readonly string[];
        ignorers: readonly string[];
      },
    ): Promise<{ files: readonly SourceFile[]; mutants: readonly Mutant[] }>;
  };
}

/**
 * Resolves the instrumenter from core's folder and imports, by file URL, `dist/src/mutators/mutate.js`
 * (`allMutators`), `dist/src/mutant-placers/index.js` (`allMutantPlacers`, of which it takes the one named
 * `expressionMutantPlacer`), `dist/src/index.js` (`Instrumenter`) and the instrumenter's own `@babel/core`.
 */
export async function resolveFromCore(
  corePackage: string = corePackageJson(),
): Promise<Instrumenter> {
  const fromCore = createRequire(corePackage);
  const packageJson = fromCore.resolve(
    '@stryker-mutator/instrumenter/package.json',
  );
  const dir = dirname(packageJson);
  const [{ allMutators }, { allMutantPlacers }, { Instrumenter }, { types }]: [
    { allMutators: NodeMutatorLike[] },
    { allMutantPlacers: readonly MutantPlacerLike[] },
    InstrumenterModule,
    { types: BabelTypes },
  ] = await Promise.all([
    importFile(join(dir, 'dist', 'src', 'mutators', 'mutate.js')),
    importFile(join(dir, 'dist', 'src', 'mutant-placers', 'index.js')),
    importFile(join(dir, 'dist', 'src', 'index.js')),
    importFile(createRequire(packageJson).resolve('@babel/core')),
  ]);
  const expressionPlacer = allMutantPlacers.find(
    ({ name }) => name === 'expressionMutantPlacer',
  );

  if (expressionPlacer === undefined) {
    throw new Error(
      `stryker-ui-mutators: the instrumenter in ${dir} has no expressionMutantPlacer.`,
    );
  }

  return {
    dir,
    version: String(fromCore(packageJson).version),
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

/** Untyped by nature; `resolveFromCore` states each module's shape where it destructures them. */
function importFile(path: string) {
  return import(pathToFileURL(path).href);
}
