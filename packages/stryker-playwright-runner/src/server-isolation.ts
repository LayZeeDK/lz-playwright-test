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

  return serverRan(dryRunServerMutants(), request.activeMutant)
    ? 'server'
    : 'other';
}

/**
 * Stryker asks for static activation of every run without a test filter
 * (@stryker-mutator/core 10.1.1 mutant-test-planner.js:148).
 */
export function startupMutantFor(
  request: RunRequest,
  dryRunServerMutants: () => ServerMutants,
): string | undefined {
  return request.kind === 'mutant' &&
    request.mutantActivation === 'static' &&
    serverRan(dryRunServerMutants(), request.activeMutant)
    ? request.activeMutant
    : undefined;
}

function serverRan(mutants: ServerMutants, mutant: string): boolean {
  return mutants === 'unknown' || mutants.has(mutant);
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
