import {
  builtInNames,
  checkBuiltInsRemoved,
  checkNames,
  corePackageJson,
  fieldOf,
  isRecord,
  isSelfCheckFile,
  register,
  removeBuiltIns,
  resolveInstrumenter,
  selectMutators,
  selfCheck,
  warnUntested,
  type Instrumenter as CoreInstrumenter,
  type MutatorSets,
} from '@layzee/stryker-mutator-install';

import type { LzPlaywrightMutator } from './mutators.ts';
import { packageName } from './package-name.ts';
import { looksLikePlaywrightTest } from './playwright-test.ts';

export interface BabelTypes {
  emptyStatement(): unknown;
  cloneNode(node: unknown): unknown;
  objectExpression(properties: readonly unknown[]): unknown;
  arrayExpression(elements: readonly unknown[]): unknown;
  stringLiteral(value: string): unknown;
  numericLiteral(value: number): unknown;
  booleanLiteral(value: boolean): unknown;
  callExpression(callee: unknown, args: readonly unknown[]): unknown;
  memberExpression(object: unknown, property: unknown): unknown;
  identifier(name: string): unknown;
}

const babelTypeMembers: Readonly<Record<keyof BabelTypes, true>> = {
  emptyStatement: true,
  cloneNode: true,
  objectExpression: true,
  arrayExpression: true,
  stringLiteral: true,
  numericLiteral: true,
  booleanLiteral: true,
  callExpression: true,
  memberExpression: true,
  identifier: true,
};

export type Instrumenter = CoreInstrumenter<BabelTypes>;

export const testedVersion = '10.1.1';

export function resolveFromCore(
  corePackage: string = corePackageJson(),
): Promise<Instrumenter> {
  return resolveInstrumenter(packageName, assertBabelTypes, corePackage);
}

export function assertBabelTypes(
  value: unknown,
  missing: (name: string) => Error,
): asserts value is BabelTypes {
  if (!isRecord(value)) {
    throw missing('Babel types');
  }

  const absent = Object.keys(babelTypeMembers).filter(
    (member) => typeof value[member] !== 'function',
  );

  if (absent.length > 0) {
    throw missing(`Babel types with ${absent.join(', ')}`);
  }
}

export async function install(
  sets: MutatorSets<LzPlaywrightMutator>,
  options: unknown,
  resolve: () => Promise<Instrumenter>,
  warn: (message: string) => void = console.warn,
  info: (message: string) => void = console.info,
): Promise<void> {
  const mutators = selectMutators(
    packageName,
    'lzPlaywrightMutators',
    sets,
    options,
  );
  const instrumenter = await resolve();

  removeBuiltIns(packageName, instrumenter, warn);
  checkNames(packageName, mutators, instrumenter.allMutators);
  register(
    packageName,
    instrumenter.allMutators,
    mutators.map(({ name, mutate }) => ({
      name,
      mutate: (path: unknown) => {
        warnAboutProgram(path, warn);

        return mutate(path, instrumenter.types);
      },
    })),
  );
  await selfCheck(packageName, instrumenter, mutators);
  await checkBuiltInsRemoved(packageName, instrumenter);
  warnUntested(packageName, testedVersion, instrumenter, warn);
  info(startLine(sets, mutators));
}

// The file names warned about in this process, whatever the number of installs.
const warnedFiles = new Set<string>();

function warnAboutProgram(
  path: unknown,
  warn: (message: string) => void,
): void {
  const file = fieldOf(
    fieldOf(fieldOf(fieldOf(path, 'hub'), 'file'), 'opts'),
    'filename',
  );
  const node = fieldOf(path, 'node');

  if (
    typeof file === 'string' &&
    fieldOf(node, 'type') === 'Program' &&
    !isSelfCheckFile(file) &&
    !warnedFiles.has(file) &&
    !looksLikePlaywrightTest(node)
  ) {
    warnedFiles.add(file);
    warn(
      `${file}: ${packageName} turned Stryker's built-in mutators off for every file in this run, and this ` +
        'file does not look like Playwright test code (no @playwright/ import, no top-level test call). Mutate ' +
        'production code in a separate Stryker config.',
    );
  }
}

function startLine(
  sets: MutatorSets<LzPlaywrightMutator>,
  mutators: readonly LzPlaywrightMutator[],
): string {
  const defaults = new Set(sets.defaults);
  const optional = mutators.filter((mutator) => !defaults.has(mutator));

  return (
    `${packageName}: Stryker's ${builtInNames.length} built-in mutators are off for every file in this run; ` +
    `${mutators.length} LzPlaywright mutators on.` +
    (optional.length > 0
      ? ` Opt-in or experimental: ${optional.map(({ name }) => name).join(', ')}.`
      : '')
  );
}
