import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { fieldOf, isRecord, isStringArray } from './is-record.ts';
import type { RunSettings } from './protocol.ts';

/** Tells the server hook, in the processes global setup starts, the folder that holds its control file. */
export const serverDirEnv = 'LZ_STRYKER_PLAYWRIGHT_SERVER';
/** The header the worker hook adds to a test's requests to the webServer. */
export const testIdHeader = 'x-lz-stryker-test';

export const controlFile = 'control.json';
export const hookedPrefix = 'hooked-';
export const serverSnapshotPrefix = 'server-';
/** A per-test coverage key for a request that came without a test id header, followed by its arrival time. */
export const untaggedPrefix = 'lz-stryker-untagged@';

export interface ServerControl extends RunSettings {
  readonly activeMutant?: string | undefined;
  readonly issuedTestIds?: readonly string[];
}

export function parseServerControl(
  raw: string | undefined,
): ServerControl | undefined {
  let value: unknown;

  try {
    value = raw === undefined ? undefined : JSON.parse(raw);
  } catch {
    // value stays undefined and reads as no control below.
  }

  if (!isRecord(value)) {
    return undefined;
  }

  const {
    outDir,
    perTest,
    activeMutant,
    hitLimit,
    issuedTestIds,
    testIdHosts,
  } = value;

  if (
    typeof outDir !== 'string' ||
    typeof perTest !== 'boolean' ||
    (activeMutant !== undefined && typeof activeMutant !== 'string') ||
    (hitLimit !== undefined && typeof hitLimit !== 'number') ||
    (issuedTestIds !== undefined && !isStringArray(issuedTestIds)) ||
    (testIdHosts !== undefined && !isStringArray(testIdHosts))
  ) {
    return undefined;
  }

  return {
    outDir,
    perTest,
    activeMutant,
    hitLimit,
    ...(issuedTestIds === undefined ? {} : { issuedTestIds }),
    ...(testIdHosts === undefined ? {} : { testIdHosts }),
  };
}

export function writeFileAtomic(dir: string, name: string, text: string) {
  const temp = path.join(dir, `${name}.${randomUUID()}`);
  fs.writeFileSync(temp, text);
  fs.renameSync(temp, path.join(dir, name));
}

export function writeServerControl(dir: string, control: ServerControl) {
  writeFileAtomic(dir, controlFile, JSON.stringify(control));
}

export function readServerControlText(dir: string): string | undefined {
  try {
    return fs.readFileSync(path.join(dir, controlFile), 'utf8');
  } catch (error) {
    if (fieldOf(error, 'code') === 'ENOENT') {
      return undefined;
    }

    throw error;
  }
}

export function readServerControl(dir: string): ServerControl | undefined {
  return parseServerControl(readServerControlText(dir));
}

export function anyHooked(dir: string): boolean {
  return fs.readdirSync(dir).some((file) => file.startsWith(hookedPrefix));
}

export function forgetHooked(dir: string) {
  fs.readdirSync(dir)
    .filter((file) => file.startsWith(hookedPrefix))
    .forEach((file) => fs.rmSync(path.join(dir, file)));
}

const localhostAliases: ReadonlySet<string> = new Set([
  '127.0.0.1',
  '[::1]',
  '0.0.0.0',
  '[::]',
]);

export function hostKey(url: URL): string {
  const host = localhostAliases.has(url.hostname) ? 'localhost' : url.hostname;
  const port = url.port || (url.protocol === 'https:' ? '443' : '80');

  return `${host}:${port}`;
}

export function untaggedKey(arrivedAt: number): string {
  return `${untaggedPrefix}${arrivedAt}`;
}

export function untaggedArrival(key: string): number | undefined {
  const arrivedAt = key.slice(untaggedPrefix.length);

  return key.startsWith(untaggedPrefix) && /^\d+$/.test(arrivedAt)
    ? Number(arrivedAt)
    : undefined;
}
