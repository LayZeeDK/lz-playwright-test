import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import type { Mutant, schema } from '@stryker-mutator/api/core';

import type { ReportedTest } from './reporter.ts';

export const tracesDirEnv = 'LZ_PLAYWRIGHT_TRACES_DIR';
export const projectRootEnv = 'LZ_PLAYWRIGHT_PROJECT_ROOT';

export interface TracesTarget {
  readonly dir: string;
  readonly projectRoot: string;
}

export function readTracesTarget(
  survivorTraces: string | undefined,
  env: Readonly<Record<string, string | undefined>>,
): TracesTarget | undefined {
  if (survivorTraces === undefined) {
    return undefined;
  }

  const dir = env[tracesDirEnv];
  const projectRoot = env[projectRootEnv];

  if (!dir || !projectRoot) {
    throw new Error(
      'lzPlaywright.survivorTraces is set, but the lz-playwright-traces reporter is not in reporters. ' +
        'Add it: it empties the traces folder at the start of each run.',
    );
  }

  return { dir, projectRoot };
}

export function reportFileName(fileName: string, projectRoot: string): string {
  return path.relative(projectRoot, fileName).replaceAll('\\', '/');
}

export type MutantIdentity = Pick<
  Mutant,
  'fileName' | 'mutatorName' | 'replacement' | 'location'
>;

type ReportedMutant = Pick<
  schema.MutantResult,
  'mutatorName' | 'replacement' | 'location'
>;

export function mutantRange({ start, end }: schema.Location): string {
  return `${start.line}:${start.column}-${end.line}:${end.column}`;
}

export function reportKey(
  fileName: string,
  { mutatorName, replacement, location }: ReportedMutant,
): string {
  return `${fileName}@${mutantRange(location)}\n${mutatorName}: ${replacement}`;
}

export function mutantKey(
  { mutatorName, replacement, location: { start, end } }: MutantIdentity,
  fileName: string,
): string {
  return reportKey(fileName, {
    mutatorName,
    replacement,
    location: {
      start: { line: start.line + 1, column: start.column + 1 },
      end: { line: end.line + 1, column: end.column + 1 },
    },
  });
}

const unsafe = /[^-0-9A-Za-z\u0080-￿]+/g;

export function folderName(key: string): string {
  const hash = createHash('sha1').update(key).digest('hex').slice(0, 8);

  return `${trimMiddle(key.replace(unsafe, '-'), 91)}-${hash}`;
}

function trimMiddle(text: string, length: number): string {
  if (text.length <= length) {
    return text;
  }

  const head = Math.floor((length - 1) / 2);

  return `${text.slice(0, head)}-${text.slice(text.length - (length - 1 - head))}`;
}

export interface CopiedTrace {
  readonly test: string;
  readonly attempt: number;
  readonly status: string;
  readonly trace: string | undefined;
}

export function copySurvivorTraces(
  tracesDir: string,
  mutant: MutantIdentity,
  relativeFileName: string,
  tests: Iterable<ReportedTest>,
): string {
  const key = mutantKey(mutant, relativeFileName);
  const dir = path.join(tracesDir, folderName(key));
  fs.mkdirSync(dir, { recursive: true });
  const copied: CopiedTrace[] = [];

  for (const test of tests) {
    const name = test.titlePath().filter(Boolean).join(' › ');

    test.results.forEach((attempt, index) => {
      const source = attempt.attachments?.find(
        (attachment) => attachment.name === 'trace' && attachment.path,
      )?.path;
      const file = source ? `${test.id}-${index}.zip` : undefined;

      if (source && file) {
        fs.copyFileSync(source, path.join(dir, file));
      }

      copied.push({
        test: name,
        attempt: index,
        status: attempt.status,
        trace: file,
      });
    });
  }

  fs.writeFileSync(
    path.join(dir, 'mutant.json'),
    JSON.stringify(
      {
        key,
        fileName: relativeFileName,
        mutatorName: mutant.mutatorName,
        replacement: mutant.replacement,
        tests: copied,
      },
      null,
      2,
    ),
  );

  return dir;
}

export function cleanTracesDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}
