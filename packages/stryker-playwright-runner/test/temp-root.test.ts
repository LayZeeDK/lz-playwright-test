import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  createTempRoot,
  isOwnDir,
  isRunning,
  removeLeftRoots,
  rootPid,
} from '../src/temp-root.ts';

function killError(code: string) {
  return () => {
    throw Object.assign(new Error(code), { code });
  };
}

function directory(uid: number) {
  return () => ({ uid, isDirectory: () => true });
}

test('a root name gives the pid of the runner that made it', () => {
  assert.equal(rootPid('stryker-playwright-4242-a1B2c3'), 4242);
});

test('names of the old scheme and other folders give no pid', () => {
  assert.equal(rootPid('stryker-pw-0-a1B2c3'), undefined);
  assert.equal(rootPid('stryker-playwright-abc-a1B2c3'), undefined);
  assert.equal(rootPid('stryker-playwright-'), undefined);
  assert.equal(rootPid('other-4242-a1B2c3'), undefined);
});

test('a process that answers signal 0 runs', () => {
  assert.equal(
    isRunning(1, () => undefined),
    true,
  );
});

test('a process that does not exist is not running', () => {
  assert.equal(isRunning(1, killError('ESRCH')), false);
});

test('a process this user may not signal still runs', () => {
  assert.equal(isRunning(1, killError('EPERM')), true);
});

test('a real directory with this user as owner is ours', () => {
  assert.equal(isOwnDir('d', { getuid: () => 501 }, directory(501)), true);
});

test("another user's directory is not ours", () => {
  assert.equal(isOwnDir('d', { getuid: () => 501 }, directory(0)), false);
});

test('a link or a file is not our directory, even on Windows', () => {
  const link = () => ({ uid: 0, isDirectory: () => false });

  assert.equal(isOwnDir('d', { getuid: () => 0 }, link), false);
  assert.equal(isOwnDir('d', {}, link), false);
});

test('on Windows, which has no uids, every real directory counts as ours', () => {
  assert.equal(isOwnDir('d', {}, directory(-1)), true);
});

test('a folder that vanished is not ours', () => {
  assert.equal(
    isOwnDir('d', {}, () => {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    }),
    false,
  );
});

// A temp directory holding the given entries, each a folder.
function tmpWith(names: string[]) {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'temp-root-test-'));
  const removed: string[] = [];

  for (const name of names) {
    mkdirSync(path.join(tmp, name));
  }

  return { tmp, removed, cleanup: () => rmSync(tmp, { recursive: true }) };
}

test('only the roots of dead runners of this user are removed, and named', () => {
  const { tmp, removed, cleanup } = tmpWith([
    'stryker-playwright-100-dead',
    'stryker-playwright-200-live',
    'stryker-playwright-300-own',
    'stryker-playwright-400-other',
    'stryker-pw-0-old',
    'unrelated-100-x',
  ]);

  try {
    const result = removeLeftRoots(tmp, {
      running: (pid) => pid === 200,
      owned: (dir) => !dir.includes('-400-'),
      remove: (dir) => removed.push(path.basename(dir)),
      ownPid: 300,
    });

    assert.deepEqual(result, ['stryker-playwright-100-dead']);
    assert.deepEqual(removed, ['stryker-playwright-100-dead']);
  } finally {
    cleanup();
  }
});

test('a root that cannot be removed now is skipped without an error', () => {
  const { tmp, cleanup } = tmpWith([
    'stryker-playwright-100-a',
    'stryker-playwright-101-b',
  ]);

  try {
    const result = removeLeftRoots(tmp, {
      running: () => false,
      owned: () => true,
      remove: (dir) => {
        if (dir.endsWith('-a')) {
          throw new Error('EBUSY');
        }
      },
      ownPid: 1,
    });

    assert.deepEqual(result, ['stryker-playwright-101-b']);
  } finally {
    cleanup();
  }
});

test('a new root is named after the pid of the runner that owns it', () => {
  const { tmp, cleanup } = tmpWith([]);

  try {
    const root = createTempRoot(tmp, 4242);

    assert.equal(rootPid(path.basename(root.dir)), 4242);
    assert.deepEqual(readdirSync(root.dir), ['runs']);
    assert.notEqual(root.nextRunDir(), root.nextRunDir());

    root.remove();

    assert.equal(existsSync(root.dir), false);
  } finally {
    cleanup();
  }
});
