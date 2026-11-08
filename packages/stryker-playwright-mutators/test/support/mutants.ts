import { coreInstrument, fieldOf } from '@layzee/stryker-mutator-install';

import type { Instrumenter } from '../../src/install.ts';
import { packageName } from '../../src/package-name.ts';

export interface Mutant {
  readonly fileName: string;
  readonly mutatorName: string;
  readonly replacement: string;
}

export async function mutantsOf(
  instrumenter: Instrumenter,
  files: readonly { readonly name: string; readonly content: string }[],
): Promise<readonly Mutant[]> {
  const instrument = await coreInstrument({ packageName, ...instrumenter });
  const mutants = fieldOf(await instrument(files), 'mutants');

  if (!Array.isArray(mutants)) {
    throw new Error('Instrumenter.instrument() gave no mutants');
  }

  return mutants.map((mutant: unknown) => ({
    fileName: String(fieldOf(mutant, 'fileName')),
    mutatorName: String(fieldOf(mutant, 'mutatorName')),
    replacement: String(fieldOf(mutant, 'replacement')),
  }));
}
