import fs from 'node:fs';
import path from 'node:path';

import type { MutantCoverage } from '@stryker-mutator/api/core';

import { isRecord } from './is-record.ts';

export const runSettingsEnv = 'LZ_STRYKER_PLAYWRIGHT_RUN';

export const snapshotSuffix = '.ndjson';

/** A worker whose hook failed to install leaves the error in a file of this suffix, as text. */
export const installErrorSuffix = '.install-error';

export const frameReadTimeoutMs = 2000;

export interface RunSettings {
  outDir: string;
  perTest: boolean;
  hitLimit?: number | undefined;
}

export interface SnapshotLine {
  mutantCoverage?: unknown;
  hitCount?: unknown;
  outlivedItsTest: boolean;
  lost?: boolean;
}

export interface Snapshot {
  readonly coverage: MutantCoverage | undefined;
  readonly hitCount: number;
  readonly outlivedItsTest: boolean;
  readonly lost: boolean;
}

export interface SnapshotDir {
  snapshots: Snapshot[];
  hookInstalled: boolean;
  installErrors: string[];
}

export function isHitCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/**
 * A page can put a BigInt or a cyclic object in its namespace, which JSON cannot hold; that frame
 * counts as lost, so the hook never throws inside Playwright's context close.
 */
export function serializeSnapshot(line: SnapshotLine): string {
  try {
    return JSON.stringify(line);
  } catch {
    return JSON.stringify({
      lost: true,
      outlivedItsTest: line.outlivedItsTest,
    } satisfies SnapshotLine);
  }
}

/** A record without a prototype, so a key such as __proto__ stays an own key. */
export function emptyRecord<T>(): Record<string, T> {
  const record: Record<string, T> = {};
  Object.setPrototypeOf(record, null);

  return record;
}

/** Untrusted entries go straight into a record without a prototype, never through an ordinary object. */
function recordOf<T>(
  entries: readonly (readonly [string, T])[],
): Record<string, T> {
  const record = emptyRecord<T>();
  entries.forEach(([key, value]) => {
    record[key] = value;
  });

  return record;
}

function hitCounts(value: unknown): Record<string, number> {
  return recordOf(
    entriesOf(value).flatMap(([mutantId, count]) =>
      isHitCount(count) ? [[mutantId, count] as const] : [],
    ),
  );
}

function entriesOf(value: unknown): [string, unknown][] {
  return Object.entries(isRecord(value) ? value : {});
}

function parseCoverage(value: unknown): MutantCoverage | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  return {
    static: hitCounts(value.static),
    perTest: recordOf(
      entriesOf(value.perTest).map(
        ([testId, hits]) => [testId, hitCounts(hits)] as const,
      ),
    ),
  };
}

export function parseSnapshotLine(line: string): Snapshot | undefined {
  let raw: unknown;

  try {
    raw = JSON.parse(line);
  } catch {
    // A killed worker leaves a partial last line; raw stays undefined.
  }

  if (!isRecord(raw)) {
    return undefined;
  }

  return {
    coverage: parseCoverage(raw.mutantCoverage),
    hitCount: isHitCount(raw.hitCount) ? raw.hitCount : 0,
    outlivedItsTest: raw.outlivedItsTest === true,
    lost: raw.lost === true,
  };
}

export function readSnapshotDir(dir: string): SnapshotDir {
  const names = fs.readdirSync(dir);
  const read = (file: string) => fs.readFileSync(path.join(dir, file), 'utf8');
  const files = names.filter((file) => file.endsWith(snapshotSuffix));
  const snapshots = files
    .flatMap((file) => read(file).split('\n'))
    .map(parseSnapshotLine)
    .filter((snapshot) => snapshot !== undefined);
  const installErrors = names
    .filter((file) => file.endsWith(installErrorSuffix))
    .map(read);

  return { snapshots, hookInstalled: files.length > 0, installErrors };
}

export function readRunSettings(
  env: NodeJS.ProcessEnv,
): RunSettings | undefined {
  const raw = env[runSettingsEnv];

  if (raw === undefined) {
    return undefined;
  }

  const refused = `${runSettingsEnv} holds no valid run settings: ${raw}`;
  let settings: unknown;

  try {
    settings = JSON.parse(raw);
  } catch (cause) {
    throw new Error(refused, { cause });
  }

  if (isRecord(settings)) {
    const { outDir, perTest, hitLimit } = settings;

    if (
      typeof outDir === 'string' &&
      typeof perTest === 'boolean' &&
      (hitLimit === undefined || typeof hitLimit === 'number')
    ) {
      return hitLimit === undefined
        ? { outDir, perTest }
        : { outDir, perTest, hitLimit };
    }
  }

  throw new Error(refused);
}
