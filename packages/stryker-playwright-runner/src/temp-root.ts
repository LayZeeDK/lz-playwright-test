import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * The runner's private temp directory. Playwright deletes and recreates `outputDir` in global setup, so
 * both directories live in a root it never touches: on a shared /tmp no other user can claim either
 * name in between. One root per runner process.
 */
export interface TempRoot {
  readonly dir: string;
  readonly outputDir: string;
  /** A fresh directory for one run's snapshot files. */
  nextRunDir(): string;
  /** The first step of dispose: a run that Stryker timed out never reaches its own cleanup. */
  removeRunsAndOutput(): void;
  /** The last step of dispose: the test that stopTests ends still writes its error context here. */
  remove(): void;
}

/**
 * Roots are named by the pid of the runner that owns them. The old scheme, `stryker-pw-<worker index>-`,
 * never matches: its number is no pid, so a live root of an older runner would look dead.
 */
export const ROOT_PREFIX = 'stryker-playwright-';

/** `stryker-playwright-<pid>-XXXXXX` -> pid; any other name -> undefined. */
export function rootPid(name: string): number | undefined {
  const pid = name.startsWith(ROOT_PREFIX)
    ? /^(\d+)-/.exec(name.slice(ROOT_PREFIX.length))?.[1]
    : undefined;

  return pid === undefined ? undefined : Number(pid);
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
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * A real directory this user owns, not a link. Windows has no uids and a temp directory per user, so
 * there every real directory counts as owned.
 */
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
 * Removes the roots in `tmp` of runners that no longer run and that this user owns, and returns their
 * names. Two runners that start at once may both try one root, and a process the dead runner started
 * may still hold it on Windows, so a removal that fails is skipped; the next runner tries again.
 */
export function removeLeftRoots(
  tmp: string,
  {
    running = isRunning,
    owned = isOwnDir,
    remove = removeDir,
    ownPid = process.pid,
  }: {
    running?: (pid: number) => boolean;
    owned?: (dir: string) => boolean;
    remove?: (dir: string) => void;
    ownPid?: number;
  } = {},
): string[] {
  const removed: string[] = [];

  for (const name of fs.readdirSync(tmp)) {
    const pid = rootPid(name);
    const dir = path.join(tmp, name);

    if (pid === undefined || pid === ownPid || running(pid) || !owned(dir)) {
      continue;
    }

    try {
      remove(dir);
      removed.push(name);
    } catch {
      // Tried again by the next runner that starts.
    }
  }

  return removed;
}

export function removeDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
}

export function createTempRoot(
  tmp: string = os.tmpdir(),
  pid: number = process.pid,
): TempRoot {
  const dir = fs.mkdtempSync(path.join(tmp, `${ROOT_PREFIX}${pid}-`));
  const outputDir = path.join(dir, 'output');
  const runsDir = path.join(dir, 'runs');
  let runs = 0;
  fs.mkdirSync(runsDir);

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
