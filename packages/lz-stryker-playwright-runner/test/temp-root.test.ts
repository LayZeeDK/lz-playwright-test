import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { type TestContext, test } from 'node:test';

import {
  createTempRoot,
  isOwnDir,
  isRunning,
  namespaceToken,
  ownerFile,
  removeLeftRoots,
  rootPid,
} from '../src/temp-root.ts';
import { codedError, tempTree } from './support/doubles.ts';

function killError(code: string) {
  return () => {
    throw codedError(code);
  };
}

function directory(uid: number) {
  return () => ({ uid, isDirectory: () => true });
}

test('a root name gives the pid of the runner that made it', () => {
  assert.equal(rootPid('lz-stryker-playwright-4242-a1B2c3'), 4242);
});

test('names of the old scheme and other folders give no pid', () => {
  assert.equal(rootPid('stryker-pw-0-a1B2c3'), undefined);
  assert.equal(rootPid('lz-stryker-playwright-abc-a1B2c3'), undefined);
  assert.equal(rootPid('lz-stryker-playwright-x12-a1B2c3'), undefined);
  assert.equal(rootPid('lz-stryker-playwright-'), undefined);
  assert.equal(rootPid('other-4242-a1B2c3'), undefined);
  // As long as the prefix, so only the prefix check keeps it out.
  assert.equal(rootPid('not-a-stryker-root-42-a1B2c3'), undefined);
});

test('a name gives a pid only in the shape mkdtemp makes, six letters or digits after the pid', () => {
  assert.equal(rootPid('lz-stryker-playwright-42-AZaz09'), 42);
  assert.equal(rootPid('lz-stryker-playwright-2024-reports'), undefined);
  assert.equal(rootPid('lz-stryker-playwright-1-a1B2c'), undefined);
  assert.equal(rootPid('lz-stryker-playwright-1-a1B_c3'), undefined);
  assert.equal(rootPid('lz-stryker-playwright-1-a1B2c3-old'), undefined);
});

test('a pid too large to be a safe integer is no pid', () => {
  assert.equal(
    rootPid('lz-stryker-playwright-9007199254740991-a1B2c3'),
    2 ** 53 - 1,
  );
  assert.equal(
    rootPid('lz-stryker-playwright-9007199254740992-a1B2c3'),
    undefined,
  );
  assert.equal(
    rootPid('lz-stryker-playwright-12345678901234567890-a1B2c3'),
    undefined,
  );
});

test('on Linux the namespace token is the inode of the pid namespace and the host name', () => {
  const files: string[] = [];
  const token = namespaceToken(
    (file) => {
      files.push(file);

      return 4026531836;
    },
    'ci-host',
    'linux',
  );

  assert.equal(token, '4026531836@ci-host');
  assert.deepEqual(files, ['/proc/self/ns/pid']);
});

test("on Linux without /proc the namespace token is this runner's own, so no other runner matches it", () => {
  assert.equal(
    namespaceToken(
      () => {
        throw codedError('ENOENT');
      },
      'ci-host',
      'linux',
      () => 'b7e4',
    ),
    'b7e4@ci-host',
  );
});

test('outside Linux the namespace token is the host name, and /proc is not looked up', () => {
  const files: string[] = [];

  (['win32', 'darwin'] as const).forEach((platform) => {
    assert.equal(
      namespaceToken(
        (file) => {
          files.push(file);

          return 1;
        },
        'dev-box',
        platform,
      ),
      'dev-box',
    );
  });

  assert.deepEqual(files, []);
});

test('the namespace token of this process names its pid namespace where there is one, and this host', () => {
  const ns = '/proc/self/ns/pid';

  assert.equal(
    namespaceToken(),
    process.platform === 'linux'
      ? `${statSync(ns).ino}@${os.hostname()}`
      : os.hostname(),
  );
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

test('a kill that throws no error object leaves the process counted as not running', () => {
  assert.equal(
    isRunning(1, () => {
      throw null;
    }),
    false,
  );
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
      throw codedError('ENOENT');
    }),
    false,
  );
});

const ownerToken = 'ns-of-this-runner';

// A temp directory holding the given entries, each a folder with an owner marker that holds `ownerToken`, and a
// `remove` double that records the base names it is given.
function tmpWith(t: TestContext, names: string[]) {
  const tmp = tempTree(
    t,
    'temp-root-test-',
    Object.fromEntries(
      names.map((name) => [path.join(name, ownerFile), ownerToken]),
    ),
  );
  const removed: string[] = [];

  return {
    tmp,
    removed,
    remove: (dir: string) => removed.push(path.basename(dir)),
  };
}

test('a dead root is removed only when its owner marker holds the token of this runner', (t) => {
  const { tmp, removed, remove } = tmpWith(t, [
    'lz-stryker-playwright-100-ours00',
    'lz-stryker-playwright-101-theirs',
    'lz-stryker-playwright-102-nomark',
    'lz-stryker-playwright-103-notxt0',
  ]);
  writeFileSync(
    path.join(tmp, 'lz-stryker-playwright-101-theirs', ownerFile),
    'ns-of-another-runner',
  );
  rmSync(path.join(tmp, 'lz-stryker-playwright-102-nomark', ownerFile));
  rmSync(path.join(tmp, 'lz-stryker-playwright-103-notxt0', ownerFile));
  mkdirSync(path.join(tmp, 'lz-stryker-playwright-103-notxt0', ownerFile));

  const result = removeLeftRoots(tmp, {
    running: () => false,
    owned: () => true,
    remove,
    ownPid: 1,
    token: ownerToken,
  });

  assert.deepEqual(result, ['lz-stryker-playwright-100-ours00']);
  assert.deepEqual(removed, ['lz-stryker-playwright-100-ours00']);
});

test('only the roots of dead runners of this user are removed, and named', (t) => {
  const { tmp, removed, remove } = tmpWith(t, [
    'lz-stryker-playwright-100-dead00',
    'lz-stryker-playwright-200-live00',
    'lz-stryker-playwright-300-own000',
    'lz-stryker-playwright-400-other0',
    'stryker-pw-0-old',
    'unrelated-100-x',
  ]);

  const result = removeLeftRoots(tmp, {
    running: (pid) => pid === 200,
    owned: (dir) => !dir.includes('-400-'),
    remove,
    ownPid: 300,
    token: ownerToken,
  });

  assert.deepEqual(result, ['lz-stryker-playwright-100-dead00']);
  assert.deepEqual(removed, ['lz-stryker-playwright-100-dead00']);
});

test('a root that cannot be removed now is skipped without an error', (t) => {
  const { tmp } = tmpWith(t, [
    'lz-stryker-playwright-100-aaaaaa',
    'lz-stryker-playwright-101-bbbbbb',
  ]);

  const result = removeLeftRoots(tmp, {
    running: () => false,
    owned: () => true,
    remove: (dir) => {
      if (dir.endsWith('-aaaaaa')) {
        throw new Error('EBUSY');
      }
    },
    ownPid: 1,
    token: ownerToken,
  });

  assert.deepEqual(result, ['lz-stryker-playwright-101-bbbbbb']);
});

test('a new root is named after the pid of the runner that owns it', (t) => {
  const tmp = tempTree(t, 'temp-root-test-');

  const root = createTempRoot(tmp, 4242, ownerToken);

  assert.equal(rootPid(path.basename(root.dir)), 4242);
  assert.deepEqual(readdirSync(root.dir).sort(), [ownerFile, 'runs']);
  assert.equal(
    readFileSync(path.join(root.dir, ownerFile), 'utf8'),
    ownerToken,
  );
  assert.deepEqual(
    [root.nextRunDir(), root.nextRunDir()],
    [path.join(root.dir, 'runs', '0'), path.join(root.dir, 'runs', '1')],
  );

  root.remove();

  assert.equal(existsSync(root.dir), false);
});

test('a root whose owner file cannot be written is removed, and the write error is thrown', (t) => {
  const tmp = tempTree(t, 'temp-root-test-');
  const full = codedError('ENOSPC');

  assert.throws(
    () =>
      createTempRoot(tmp, 4242, ownerToken, () => {
        throw full;
      }),
    (error) => error === full,
  );
  assert.deepEqual(readdirSync(tmp), []);
});
