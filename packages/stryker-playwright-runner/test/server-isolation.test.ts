import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { test } from 'node:test';

import {
  readServerMutantsFile,
  restartsToIsolate,
  writeServerMutantsFile,
} from '../src/server-isolation.ts';
import { tempTree } from './support/doubles.ts';

test('a run that is not a server run, after another such run, keeps the webServer', () => {
  assert.equal(restartsToIsolate(true, 'other', 'other'), false);
});

test('a server run restarts the webServer after a run that is not one', () => {
  assert.equal(restartsToIsolate(true, 'other', 'server'), true);
});

test('a run after a server run restarts the webServer, so the server run leaves no state behind', () => {
  assert.equal(restartsToIsolate(true, 'server', 'other'), true);
});

test('a server run after a server run restarts the webServer', () => {
  assert.equal(restartsToIsolate(true, 'server', 'server'), true);
});

test('isolate false never restarts the webServer to isolate a run', () => {
  const kinds = ['server', 'other'] as const;

  assert.deepEqual(
    kinds.flatMap((previous) =>
      kinds.map((next) => restartsToIsolate(false, previous, next)),
    ),
    [false, false, false, false],
  );
});

test('another process reads the server mutants the dry run process wrote to the shared folder', (t) => {
  const dir = tempTree(t, 'server-mutants-');

  writeServerMutantsFile(dir, ['2', '4']);

  assert.deepEqual(readServerMutantsFile(dir), {
    mutants: new Set(['2', '4']),
  });
});

test('a dry run whose server ran no mutant leaves an empty set', (t) => {
  const dir = tempTree(t, 'server-mutants-');

  writeServerMutantsFile(dir, []);

  assert.deepEqual(readServerMutantsFile(dir), { mutants: new Set() });
});

test('a write leaves only the finished file, so a reader never sees it half written', (t) => {
  const dir = tempTree(t, 'server-mutants-');

  writeServerMutantsFile(dir, ['2']);
  writeServerMutantsFile(dir, ['4']);

  assert.deepEqual(readdirSync(dir), ['.lz-playwright-server-mutants']);
  assert.deepEqual(readServerMutantsFile(dir), { mutants: new Set(['4']) });
});

test('a write that never finished is not read', (t) => {
  const dir = tempTree(t, 'server-mutants-', {
    '.lz-playwright-server-mutants.0b1c': '2\n',
  });

  assert.ok('cause' in readServerMutantsFile(dir));
});

test('a folder without the file gives the cause instead of server mutants', (t) => {
  const dir = tempTree(t, 'server-mutants-');

  const result = readServerMutantsFile(dir);

  assert.ok('cause' in result);
  assert.match(result.cause, /ENOENT.*\.lz-playwright-server-mutants/);
});
