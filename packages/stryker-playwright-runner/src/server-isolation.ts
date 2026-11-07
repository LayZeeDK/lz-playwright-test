import fs from 'node:fs';
import path from 'node:path';

import type { RunRequest } from './run-request.ts';
import { writeFileAtomic } from './server-protocol.ts';

export type RunKind = 'server' | 'other';

export type ServerMutants = ReadonlySet<string> | 'unknown';

export function runKind(
  request: RunRequest,
  dryRunServerMutants: () => ServerMutants,
): RunKind {
  if (request.kind !== 'mutant') {
    return 'other';
  }

  const mutants = dryRunServerMutants();

  return mutants === 'unknown' || mutants.has(request.activeMutant)
    ? 'server'
    : 'other';
}

export function restartsToIsolate(
  isolate: boolean,
  previous: RunKind,
  next: RunKind,
): boolean {
  return isolate && (previous === 'server' || next === 'server');
}

export type ServerMutantsFile =
  | { readonly mutants: ReadonlySet<string> }
  | { readonly cause: string };

export const serverMutantsFile = '.lz-playwright-server-mutants';

export function writeServerMutantsFile(
  dir: string,
  mutants: Iterable<string>,
): void {
  writeFileAtomic(dir, serverMutantsFile, [...mutants].join('\n'));
}

export function readServerMutantsFile(dir: string): ServerMutantsFile {
  try {
    const text = fs.readFileSync(path.join(dir, serverMutantsFile), 'utf8');

    return { mutants: new Set(text.split('\n').filter(Boolean)) };
  } catch (error) {
    return { cause: String(error) };
  }
}
