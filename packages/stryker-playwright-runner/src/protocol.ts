import fs from 'node:fs';
import path from 'node:path';

import type { MutantCoverage } from '@stryker-mutator/api/core';

import { isRecord, isStringArray } from './is-record.ts';
import { serverSnapshotPrefix } from './server-protocol.ts';

export const runSettingsEnv = 'LZ_STRYKER_PLAYWRIGHT_RUN';

export const snapshotSuffix = '.ndjson';

export const workerFilePrefix = 'worker-';

export const installErrorSuffix = '.install-error';

export const frameReadTimeoutMs = 2000;

export interface RunSettings {
  readonly outDir: string;
  readonly perTest: boolean;
  readonly hitLimit?: number | undefined;
  /** The webServer hosts (see hostKey) whose requests from a test's page carry the test id header. */
  readonly testIdHosts?: readonly string[] | undefined;
  readonly pageHelpers?: string | undefined;
}

export interface PageSettings extends Pick<RunSettings, 'hitLimit'> {
  readonly ns: string;
  readonly activeMutant?: string | undefined;
  readonly testId?: string | undefined;
}

export interface SnapshotLine {
  readonly mutantCoverage?: unknown;
  readonly hitCount?: unknown;
  readonly outlivedItsTest: boolean;
  readonly lost?: boolean;
}

export interface Snapshot {
  readonly coverage: MutantCoverage | undefined;
  readonly hitCount: number;
  readonly outlivedItsTest: boolean;
  readonly lost: boolean;
}

export interface SnapshotDir {
  readonly snapshots: readonly Snapshot[];
  readonly hookInstalled: boolean;
  readonly installErrors: readonly string[];
  readonly serverMutants: readonly string[];
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

export function nullPrototypeRecord<T>(): Record<string, T> {
  const record: Record<string, T> = {};
  Object.setPrototypeOf(record, null);

  return record;
}

function nullPrototypeRecordOf<T>(
  entries: readonly (readonly [string, T])[],
): Record<string, T> {
  const record = nullPrototypeRecord<T>();
  entries.forEach(([key, value]) => {
    record[key] = value;
  });

  return record;
}

function hitCounts(value: unknown): Record<string, number> {
  return nullPrototypeRecordOf(
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
    static: hitCounts(value['static']),
    perTest: nullPrototypeRecordOf(
      entriesOf(value['perTest']).map(
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
    coverage: parseCoverage(raw['mutantCoverage']),
    hitCount: isHitCount(raw['hitCount']) ? raw['hitCount'] : 0,
    outlivedItsTest: raw['outlivedItsTest'] === true,
    lost: raw['lost'] === true,
  };
}

export function readSnapshotDir(dir: string): SnapshotDir {
  const names = fs.readdirSync(dir);
  const read = (file: string) => fs.readFileSync(path.join(dir, file), 'utf8');
  const files = names.filter((file) => file.endsWith(snapshotSuffix));
  const snapshotsIn = (file: string) =>
    read(file)
      .split('\n')
      .map(parseSnapshotLine)
      .filter((snapshot) => snapshot !== undefined);
  const installErrors = names
    .filter((file) => file.endsWith(installErrorSuffix))
    .map(read);

  return {
    snapshots: files.flatMap(snapshotsIn),
    hookInstalled: files.some((file) => file.startsWith(workerFilePrefix)),
    installErrors,
    serverMutants: [
      ...new Set(
        files
          .filter((file) => file.startsWith(serverSnapshotPrefix))
          .flatMap(snapshotsIn)
          .flatMap(({ coverage }) => coveredMutants(coverage)),
      ),
    ],
  };
}

function coveredMutants(coverage: MutantCoverage | undefined): string[] {
  if (!coverage) {
    return [];
  }

  return [
    ...Object.keys(coverage.static),
    ...Object.values(coverage.perTest).flatMap((hits) => Object.keys(hits)),
  ];
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
    const { outDir, perTest, hitLimit, testIdHosts, pageHelpers } = settings;

    if (
      typeof outDir === 'string' &&
      typeof perTest === 'boolean' &&
      (hitLimit === undefined || typeof hitLimit === 'number') &&
      (testIdHosts === undefined || isStringArray(testIdHosts)) &&
      (pageHelpers === undefined || typeof pageHelpers === 'string')
    ) {
      return {
        outDir,
        perTest,
        ...(hitLimit === undefined ? {} : { hitLimit }),
        ...(testIdHosts === undefined ? {} : { testIdHosts }),
        ...(pageHelpers === undefined ? {} : { pageHelpers }),
      };
    }
  }

  throw new Error(refused);
}
