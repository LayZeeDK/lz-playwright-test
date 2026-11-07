import type { MutantStatus, Position } from '@stryker-mutator/api/core';
import type { Ignorer } from '@stryker-mutator/api/ignore';

import {
  coreInstrument,
  type Instrumenter,
  type SourceFile,
} from '../../src/install.ts';
import { fieldOf } from '../../src/is-record.ts';
import { packageName } from '../../src/package-name.ts';

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
  readonly statusReason?: string | undefined;
}

export interface InstrumentResult {
  readonly files: readonly SourceFile[];
  readonly mutants: readonly InstrumentedMutant[];
}

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

export async function instrumentFully(
  instrumenter: Instrumenter,
  files: readonly SourceFile[],
  excludedMutations: readonly string[] = [],
  ignorers: readonly Ignorer[] = [],
): Promise<InstrumentResult> {
  const instrument = await coreInstrument({ packageName, ...instrumenter });
  const result = await instrument(files, excludedMutations, ignorers);
  const fileList = fieldOf(result, 'files');
  const mutants = fieldOf(result, 'mutants');

  if (!Array.isArray(fileList) || !Array.isArray(mutants)) {
    throw changed('files or mutants');
  }

  return {
    files: fileList.map((file: unknown) => ({
      name: stringOf(file, 'name'),
      content: stringOf(file, 'content'),
    })),
    mutants: mutants.map((mutant: unknown) => {
      const location = fieldOf(mutant, 'location');
      const status = fieldOf(mutant, 'status');
      const statusReason = fieldOf(mutant, 'statusReason');

      return {
        id: stringOf(mutant, 'id'),
        fileName: stringOf(mutant, 'fileName'),
        mutatorName: stringOf(mutant, 'mutatorName'),
        replacement: stringOf(mutant, 'replacement'),
        location: {
          start: positionOf(fieldOf(location, 'start')),
          end: positionOf(fieldOf(location, 'end')),
        },
        status: status === undefined ? undefined : statusOf(status),
        statusReason:
          statusReason === undefined
            ? undefined
            : stringOf(mutant, 'statusReason'),
      };
    }),
  };
}

function changed(what: string): Error {
  return new Error(`Instrumenter.instrument() gave no valid ${what}`);
}

function stringOf(value: unknown, key: string): string {
  const found = fieldOf(value, key);

  if (typeof found !== 'string') {
    throw changed(key);
  }

  return found;
}

function positionOf(value: unknown): Position {
  const numberOf = (key: string): number => {
    const found = fieldOf(value, key);

    if (typeof found !== 'number') {
      throw changed(`location ${key}`);
    }

    return found;
  };

  return { line: numberOf('line'), column: numberOf('column') };
}

function statusOf(value: unknown): MutantStatus {
  const known = statuses.find((status) => status === value);

  if (known === undefined) {
    throw changed('status');
  }

  return known;
}
