import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { Ignorer } from '@stryker-mutator/api/ignore';

import { field } from '../../src/node-field.ts';

export interface Instrumented {
  readonly code: string;
  readonly mutants: readonly InstrumentedMutant[];
  readonly warnings: readonly string[];
}

export interface InstrumentedMutant {
  readonly mutatorName: string;
  readonly line: number;
  readonly replacement: string;
  readonly ignoreReason: string | undefined;
}

const core = createRequire(import.meta.url).resolve(
  '@stryker-mutator/core/package.json',
);
const instrumenterDir = dirname(
  createRequire(core).resolve('@stryker-mutator/instrumenter/package.json'),
);
const instrumenterModule: unknown = await import(
  pathToFileURL(join(instrumenterDir, 'dist', 'src', 'index.js')).href
);

/** Instruments one file with StrykerJS's own instrumenter, every built-in mutator and the given ignorers. */
export async function instrument(
  fileName: string,
  content: string,
  ignorers: readonly Ignorer[],
): Promise<Instrumented> {
  const Instrumenter = field(instrumenterModule, 'Instrumenter');
  const warnings: string[] = [];
  const logger = {
    isDebugEnabled: () => false,
    isTraceEnabled: () => false,
    debug: () => undefined,
    trace: () => undefined,
    info: () => undefined,
    warn: (message: unknown) => warnings.push(String(message)),
    error: (message: unknown) => warnings.push(String(message)),
    fatal: (message: unknown) => warnings.push(String(message)),
  };

  if (typeof Instrumenter !== 'function') {
    throw new Error('the Stryker instrumenter exports no Instrumenter class');
  }

  const instrumenter: unknown = Reflect.construct(Instrumenter, [logger]);
  const instrumentMethod = field(instrumenter, 'instrument');

  if (typeof instrumentMethod !== 'function') {
    throw new Error('the Stryker instrumenter has no instrument method');
  }

  const result: unknown = await Reflect.apply(instrumentMethod, instrumenter, [
    [{ name: fileName, content, mutate: true }],
    { plugins: null, excludedMutations: [], ignorers },
  ]);
  const files = field(result, 'files');
  const mutants = field(result, 'mutants');
  const code = Array.isArray(files) ? field(files[0], 'content') : undefined;

  if (typeof code !== 'string' || !Array.isArray(mutants)) {
    throw new Error('Instrumenter.instrument() gave no files or mutants');
  }

  return {
    code,
    warnings,
    mutants: mutants.map((mutant: unknown) => {
      const mutatorName = field(mutant, 'mutatorName');
      const line = field(mutant, 'location', 'start', 'line');
      const replacement = field(mutant, 'replacement');
      const statusReason = field(mutant, 'statusReason');

      if (
        typeof mutatorName !== 'string' ||
        typeof line !== 'number' ||
        typeof replacement !== 'string'
      ) {
        throw new Error(
          'Instrumenter.instrument() gave a mutant of an unknown shape',
        );
      }

      return {
        mutatorName,
        line: line + 1,
        replacement,
        ignoreReason:
          field(mutant, 'status') === 'Ignored' &&
          typeof statusReason === 'string'
            ? statusReason
            : undefined,
      };
    }),
  };
}
