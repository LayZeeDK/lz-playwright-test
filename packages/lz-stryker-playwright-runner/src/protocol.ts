import fs from 'node:fs';
import path from 'node:path';

import type { MutantCoverage } from '@stryker-mutator/api/core';

import { isRecord } from './playwright-internals.ts';

export const RUN_SETTINGS = 'LZ_STRYKER_PLAYWRIGHT_RUN';

export const SNAPSHOT_SUFFIX = '.ndjson';

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
  const counts = emptyRecord<number>();

  for (const [mutantId, count] of Object.entries(
    isRecord(value) ? value : {},
  )) {
    if (isHitCount(count)) {
      counts[mutantId] = count;
    }
  }

  return counts;
}

function parseCoverage(value: unknown): MutantCoverage | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const perTest: MutantCoverage['perTest'] = emptyRecord();

  for (const [testId, hits] of Object.entries(
    isRecord(value.perTest) ? value.perTest : {},
  )) {
    perTest[testId] = hitCounts(hits);
  }

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
  const files = fs
    .readdirSync(dir)
    .filter((file) => file.endsWith(SNAPSHOT_SUFFIX));
  const snapshots = files
    .flatMap((file) =>
      fs.readFileSync(path.join(dir, file), 'utf8').split('\n'),
    )
    .map(parseSnapshotLine)
    .filter((snapshot) => snapshot !== undefined);

  return { snapshots, hookInstalled: files.length > 0 };
}

export function readRunSettings(
  env: NodeJS.ProcessEnv,
): RunSettings | undefined {
  const raw = env[RUN_SETTINGS];

  if (raw === undefined) {
    return undefined;
  }

  const settings: unknown = JSON.parse(raw);

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

  throw new Error(`${RUN_SETTINGS} holds no valid run settings: ${raw}`);
}
