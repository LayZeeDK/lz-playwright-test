import {
  coreInstrument,
  fieldOf,
  type SourceFile,
} from '@layzee/stryker-mutator-install';
import type { Ignorer } from '@stryker-mutator/api/ignore';

import type { Instrumenter } from '../../src/install.ts';
import { packageName } from '../../src/package-name.ts';

export interface Mutant {
  readonly fileName: string;
  readonly mutatorName: string;
  readonly replacement: string;
}

/** The mutants the core instrumenter makes of `files`, as it returns them. */
export async function instrumentedMutants(
  instrumenter: Instrumenter,
  files: readonly SourceFile[],
  ignorers: readonly Ignorer[] = [],
): Promise<readonly unknown[]> {
  const instrument = await coreInstrument({ packageName, ...instrumenter });
  const mutants = fieldOf(await instrument(files, [], ignorers), 'mutants');

  if (!Array.isArray(mutants)) {
    throw new Error('Instrumenter.instrument() gave no mutants');
  }

  const list: readonly unknown[] = mutants;

  return list;
}

export async function mutantsOf(
  instrumenter: Instrumenter,
  files: readonly SourceFile[],
): Promise<readonly Mutant[]> {
  const mutants = await instrumentedMutants(instrumenter, files);

  return mutants.map((mutant) => ({
    fileName: String(fieldOf(mutant, 'fileName')),
    mutatorName: String(fieldOf(mutant, 'mutatorName')),
    replacement: String(fieldOf(mutant, 'replacement')),
  }));
}
