import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { MutantStatus, Position } from '@stryker-mutator/api/core';

import type { Instrumenter, SourceFile } from '../../src/install.ts';
import { fieldOf } from '../../src/is-record.ts';
import { exportedFunction } from './exports.ts';

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

async function run(
  { dir }: Instrumenter,
  files: readonly SourceFile[],
  excludedMutations: readonly string[],
): Promise<unknown> {
  const coreInstrumenter = exportedFunction(
    await import(pathToFileURL(join(dir, 'dist', 'src', 'index.js')).href),
    'Instrumenter',
  );
  const instrumenter: unknown = Reflect.construct(coreInstrumenter, [
    silentLogger,
  ]);
  const instrument = exportedFunction(instrumenter, 'instrument');

  return Reflect.apply(instrument, instrumenter, [
    files.map((file) => ({ ...file, mutate: true })),
    { plugins: null, excludedMutations, ignorers: [] },
  ]);
}

export async function instrumentFully(
  instrumenter: Instrumenter,
  files: readonly SourceFile[],
  excludedMutations: readonly string[] = [],
): Promise<InstrumentResult> {
  const result = await run(instrumenter, files, excludedMutations);
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
