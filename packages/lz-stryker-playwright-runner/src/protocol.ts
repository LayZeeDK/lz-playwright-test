import fs from 'node:fs';
import path from 'node:path';

import type { MutantCoverage } from '@stryker-mutator/api/core';

import { isRecord } from './is-record.ts';

export const RUN_SETTINGS = 'LZ_STRYKER_PLAYWRIGHT_RUN';

export const SNAPSHOT_SUFFIX = '.ndjson';

/** A worker whose hook failed to install leaves the error in a file of this suffix, as text. */
export const INSTALL_ERROR_SUFFIX = '.install-error';

export const FRAME_READ_TIMEOUT_MS = 2000;

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

// A key such as __proto__ or a count that is not a hit count must not reach an ordinary object.
function hitCounts(value: unknown): Record<string, number> {
  return Object.assign(
    emptyRecord<number>(),
    Object.fromEntries(
      entriesOf(value).flatMap(([mutantId, count]) =>
        isHitCount(count) ? [[mutantId, count] as const] : [],
      ),
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

  const perTest: MutantCoverage['perTest'] = Object.assign(
    emptyRecord<Record<string, number>>(),
    Object.fromEntries(
      entriesOf(value.perTest).map(([testId, hits]) => [
        testId,
        hitCounts(hits),
      ]),
    ),
  );

  return { static: hitCounts(value.static), perTest };
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
  const files = names.filter((file) => file.endsWith(SNAPSHOT_SUFFIX));
  const snapshots = files
    .flatMap((file) => read(file).split('\n'))
    .map(parseSnapshotLine)
    .filter((snapshot) => snapshot !== undefined);
  const installErrors = names
    .filter((file) => file.endsWith(INSTALL_ERROR_SUFFIX))
    .map(read);

  return { snapshots, hookInstalled: files.length > 0, installErrors };
}

export function readRunSettings(
  env: NodeJS.ProcessEnv,
): RunSettings | undefined {
  const raw = env[RUN_SETTINGS];

  if (raw === undefined) {
    return undefined;
  }

  const refused = `${RUN_SETTINGS} holds no valid run settings: ${raw}`;
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
