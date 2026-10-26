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

export function removeDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
}

export function createTempRoot(tmp: string = os.tmpdir()): TempRoot {
  const dir = fs.mkdtempSync(
    path.join(tmp, `stryker-pw-${process.env.STRYKER_MUTATOR_WORKER ?? 0}-`),
  );
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
