import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { isRecord } from './is-record.ts';

/**
 * Playwright deletes and recreates `outputDir` in global setup, so both directories live in a root it
 * never touches: on a shared /tmp no other user can claim either name in between.
 */
export interface TempRoot {
  readonly dir: string;
  readonly outputDir: string;
  nextRunDir(): string;
  removeRunsAndOutput(): void;
  remove(): void;
}

export const rootPrefix = 'lz-stryker-playwright-';
export const ownerFile = 'owner';

// mkdtemp appends six letters or digits.
export function rootPid(name: string): number | undefined {
  const pid = name.startsWith(rootPrefix)
    ? Number(/^(\d+)-[A-Za-z0-9]{6}$/.exec(name.slice(rootPrefix.length))?.[1])
    : undefined;

  return Number.isSafeInteger(pid) ? pid : undefined;
}

/**
 * Names the PID namespace this process sees pids in. Containers that share /tmp, or hosts that share
 * an NFS temp directory, see one another's roots but not one another's processes. The host name
 * alone is not enough: a container started with `--network host` has the host's name. On Linux each
 * PID namespace is a file under /proc with its own inode.
 */
export function namespaceToken(
  inode: (file: string) => number = (file) => fs.statSync(file).ino,
  host: string = os.hostname(),
  platform: NodeJS.Platform = process.platform,
  unique: () => string = randomUUID,
): string {
  if (platform !== 'linux') {
    return host;
  }

  try {
    return `${inode('/proc/self/ns/pid')}@${host}`;
  } catch {
    // Without /proc another runner here may sit in another PID namespace, so no other runner may match.
    return `${unique()}@${host}`;
  }
}

/** EPERM means the process exists but belongs to someone else, so it counts as running. */
export function isRunning(
  pid: number,
  kill: (pid: number, signal: 0) => void = (target, signal) =>
    process.kill(target, signal),
): boolean {
  try {
    kill(pid, 0);

    return true;
  } catch (error) {
    return isRecord(error) && error.code === 'EPERM';
  }
}

// Windows has no uids and a temp directory per user, so there every real directory counts as owned.
export function isOwnDir(
  dir: string,
  user: { getuid?: () => number } = process,
  stat: (path: string) => {
    uid: number;
    isDirectory(): boolean;
  } = fs.lstatSync,
): boolean {
  try {
    const stats = stat(dir);

    return (
      stats.isDirectory() &&
      (user.getuid === undefined || stats.uid === user.getuid())
    );
  } catch {
    return false;
  }
}

/**
 * Two runners that start at once may both try one root, and a process the dead runner started may
 * still hold it on Windows, so a removal that fails is skipped; the next runner tries again.
 */
export function removeLeftRoots(
  tmp: string,
  {
    running = isRunning,
    owned = isOwnDir,
    remove = removeDir,
    ownPid = process.pid,
    token,
  }: {
    running?: (pid: number) => boolean;
    owned?: (dir: string) => boolean;
    remove?: (dir: string) => void;
    ownPid?: number;
    token: string;
  },
): string[] {
  return fs.readdirSync(tmp).flatMap((name) => {
    const pid = rootPid(name);
    const dir = path.join(tmp, name);

    if (pid === undefined || pid === ownPid || running(pid) || !owned(dir)) {
      return [];
    }

    try {
      if (fs.readFileSync(path.join(dir, ownerFile), 'utf8') === token) {
        remove(dir);

        return [name];
      }
    } catch {
      // A root whose owner file cannot be read is kept; one that cannot be removed now, the next
      // runner that starts tries again.
    }

    return [];
  });
}

export function removeDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
}

/**
 * Sweeps the roots dead runners left, reports them, then creates this runner's root, both with one
 * namespace token.
 */
export function claimTempRoot(
  onRemoved: (removed: readonly string[]) => void,
): TempRoot {
  const tmp = os.tmpdir();
  const token = namespaceToken();
  onRemoved(removeLeftRoots(tmp, { token }));

  return createTempRoot(tmp, process.pid, token);
}

export function createTempRoot(
  tmp: string,
  pid: number,
  token: string,
  writeFile: (file: string, data: string) => void = fs.writeFileSync,
): TempRoot {
  const dir = fs.mkdtempSync(path.join(tmp, `${rootPrefix}${pid}-`));
  const outputDir = path.join(dir, 'output');
  const runsDir = path.join(dir, 'runs');
  let runs = 0;

  try {
    writeFile(path.join(dir, ownerFile), token);
    fs.mkdirSync(runsDir);
  } catch (error) {
    removeDir(dir);
    throw error;
  }

  return {
    dir,
    outputDir,
    nextRunDir() {
      const runDir = path.join(runsDir, String(runs++));
      fs.mkdirSync(runDir);

      return runDir;
    },
    removeRunsAndOutput() {
      removeDir(runsDir);
      removeDir(outputDir);
    },
    remove() {
      removeDir(dir);
    },
  };
}
