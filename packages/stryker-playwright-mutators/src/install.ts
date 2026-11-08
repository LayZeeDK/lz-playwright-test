import {
  builtInNames,
  checkBuiltInsRemoved,
  checkNames,
  corePackageJson,
  isRecord,
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

export type BabelTypes = Readonly<Record<string, unknown>>;

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
  register(packageName, instrumenter.allMutators, mutators);
  await selfCheck(packageName, instrumenter, mutators);
  await checkBuiltInsRemoved(packageName, instrumenter);
  warnUntested(packageName, testedVersion, instrumenter, warn);
  info(startLine(sets, mutators));
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
