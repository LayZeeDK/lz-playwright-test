import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { isRecord, isStringArray } from './is-record.ts';

/** Tells the server hook, in the processes global setup starts, the folder that holds its control file. */
export const serverDirEnv = 'LZ_STRYKER_PLAYWRIGHT_SERVER';
/** The header the worker hook adds to a test's requests to the webServer. */
export const testIdHeader = 'x-lz-stryker-test';

export const controlFile = 'control.json';
export const hookedPrefix = 'hooked-';
export const serverSnapshotPrefix = 'server-';
/** A per-test coverage key for a request that came without a test id header, followed by its arrival time. */
export const untaggedPrefix = 'lz-stryker-untagged@';

export const mutateOption = 'lzPlaywright.webServer.mutate';

export function refusalMessage(mutate: string, reason: string): string {
  return `${mutateOption} is ${mutate}${reason}`;
}

export class ServerSupportRefused extends Error {
  readonly reason: string;

  constructor(
    reason: string,
    { mutate = 'true', ...options }: ErrorOptions & { mutate?: string } = {},
  ) {
    super(refusalMessage(mutate, reason), options);
    this.reason = reason;
  }
}

/** What one run tells the server hook, read again on every request. */
export interface ServerControl {
  readonly outDir: string;
  readonly perTest: boolean;
  readonly activeMutant?: string | undefined;
  readonly hitLimit?: number | undefined;
  readonly issuedTestIds?: readonly string[];
}

export function parseServerControl(raw: string): ServerControl | undefined {
  let value: unknown;

  try {
    value = JSON.parse(raw);
  } catch {
    return undefined;
  }

  if (!isRecord(value)) {
    return undefined;
  }

  const { outDir, perTest, activeMutant, hitLimit, issuedTestIds } = value;

  if (
    typeof outDir !== 'string' ||
    typeof perTest !== 'boolean' ||
    (activeMutant !== undefined && typeof activeMutant !== 'string') ||
    (hitLimit !== undefined && typeof hitLimit !== 'number') ||
    (issuedTestIds !== undefined && !isStringArray(issuedTestIds))
  ) {
    return undefined;
  }

  return {
    outDir,
    perTest,
    activeMutant,
    hitLimit,
    ...(issuedTestIds === undefined ? {} : { issuedTestIds }),
  };
}

/** Replaces the file in one rename, so a server that reads it mid-write sees the old run or the new one. */
export function writeServerControl(dir: string, control: ServerControl) {
  const temp = path.join(dir, `${controlFile}.${randomUUID()}`);
  fs.writeFileSync(temp, JSON.stringify(control));
  fs.renameSync(temp, path.join(dir, controlFile));
}

export function readServerControl(dir: string): ServerControl | undefined {
  try {
    return parseServerControl(
      fs.readFileSync(path.join(dir, controlFile), 'utf8'),
    );
  } catch {
    return undefined;
  }
}

export function anyHooked(dir: string): boolean {
  return fs.readdirSync(dir).some((file) => file.startsWith(hookedPrefix));
}

export function forgetHooked(dir: string) {
  fs.readdirSync(dir)
    .filter((file) => file.startsWith(hookedPrefix))
    .forEach((file) => fs.rmSync(path.join(dir, file), { force: true }));
}

const loopbackHosts: ReadonlySet<string> = new Set([
  'localhost',
  '127.0.0.1',
  '[::1]',
]);

/** Host and port, with every loopback name as localhost, so the webServer's url matches what a page asks for. */
export function hostKey(url: URL): string {
  const host = loopbackHosts.has(url.hostname) ? 'localhost' : url.hostname;
  const port = url.port || (url.protocol === 'https:' ? '443' : '80');

  return `${host}:${port}`;
}

export function untaggedKey(arrivedAt: number): string {
  return `${untaggedPrefix}${arrivedAt}`;
}

export function untaggedArrival(key: string): number | undefined {
  const arrivedAt = key.startsWith(untaggedPrefix)
    ? key.slice(untaggedPrefix.length)
    : '';

  return /^\d+$/.test(arrivedAt) ? Number(arrivedAt) : undefined;
}
