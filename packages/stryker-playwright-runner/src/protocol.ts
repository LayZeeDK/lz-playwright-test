// The file format between the runner and the worker hook, in both directions.
import fs from 'node:fs';
import path from 'node:path';

import type { MutantCoverage } from '@stryker-mutator/api/core';

// Playwright forks fresh workers for every run with process.env, so one environment variable carries
// the run's settings from the runner to the worker hook.
export const RUN_SETTINGS = 'STRYKER_PLAYWRIGHT_RUN';

// Each Playwright worker's hook writes its snapshots, one JSON object per line, to a file in outDir
// with this suffix.
export const SNAPSHOT_SUFFIX = '.ndjson';

// How long the hook waits for a frame to answer before it counts the frame as lost. A timed-out test
// spends this long on its hung page, so the runner's timeout headroom includes it.
export const FRAME_READ_TIMEOUT_MS = 2000;

export interface RunSettings {
  outDir: string;
  perTest: boolean;
  hitLimit?: number;
}

/**
 * One line of a snapshot file as the hook writes it: what a page frame held before its context closed.
 * Page code wrote it, so nothing in it is trusted until `parseSnapshotLine`.
 */
export interface SnapshotLine {
  mutantCoverage?: unknown;
  hitCount?: unknown;
  outlivedItsTest: boolean;
  /** The frame did not answer in time, so its coverage is unknown. */
  lost?: boolean;
}

/** A snapshot line after the runner parsed it: valid counts in null-prototype maps, every flag set. */
export interface Snapshot {
  readonly coverage: MutantCoverage | undefined;
  readonly hitCount: number;
  /** The context outlived the test that made it, so its per-test coverage counts as static. */
  readonly outlivedItsTest: boolean;
  /** The frame did not answer within FRAME_READ_TIMEOUT_MS. */
  readonly lost: boolean;
}

export interface SnapshotDir {
  snapshots: Snapshot[];
  /** Some worker created its file at install, so "no hook" and "no instrumented page" differ. */
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

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

// A key such as __proto__ or a count that is not a hit count must not reach an ordinary object.
function hitCounts(value: unknown): Record<string, number> {
  const counts: Record<string, number> = Object.create(null);

  for (const [mutantId, count] of Object.entries(
    isObject(value) ? value : {},
  )) {
    if (isHitCount(count)) {
      counts[mutantId] = count;
    }
  }

  return counts;
}

function parseCoverage(value: unknown): MutantCoverage | undefined {
  if (!isObject(value)) {
    return undefined;
  }

  const perTest: MutantCoverage['perTest'] = Object.create(null);

  for (const [testId, hits] of Object.entries(
    isObject(value.perTest) ? value.perTest : {},
  )) {
    perTest[testId] = hitCounts(hits);
  }

  return { static: hitCounts(value.static), perTest };
}

/** Undefined for a partial last line, which a killed worker leaves, or a line that is not an object. */
export function parseSnapshotLine(line: string): Snapshot | undefined {
  let raw: unknown;

  try {
    raw = JSON.parse(line);
  } catch {
    // raw stays undefined, which is no object.
  }

  if (!isObject(raw)) {
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

  return raw === undefined ? undefined : (JSON.parse(raw) as RunSettings);
}
