import assert from 'node:assert/strict';
import { readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import {
  anyHooked,
  controlFile,
  forgetHooked,
  hookedPrefix,
  hostKey,
  parseServerControl,
  readServerControl,
  untaggedArrival,
  untaggedKey,
  untaggedPrefix,
  writeServerControl,
} from '../src/server-protocol.ts';
import { tempTree } from './support/doubles.ts';

test('a control file written by the runner reads back whole, and its temp file is gone', (t) => {
  const dir = tempTree(t, 'server-control-');
  const control = {
    outDir: 'runs/3',
    perTest: false,
    activeMutant: '7',
    hitLimit: 40,
    issuedTestIds: ['a1b2-c3', 'd4e5-f6'],
  };

  writeServerControl(dir, control);
  writeServerControl(dir, { ...control, outDir: 'runs/4' });

  assert.deepEqual(readServerControl(dir), { ...control, outDir: 'runs/4' });
  assert.deepEqual(readdirSync(dir), [controlFile]);
});

test('a missing or invalid control file reads as none', (t) => {
  const dir = tempTree(t, 'server-control-');

  assert.equal(readServerControl(dir), undefined);

  [
    '{"outDir":"o"',
    'null',
    '[]',
    '{"perTest":true}',
    '{"outDir":"o","perTest":"yes"}',
    '{"outDir":"o","perTest":true,"activeMutant":7}',
    '{"outDir":"o","perTest":true,"hitLimit":"9"}',
    '{"outDir":"o","perTest":true,"issuedTestIds":"a"}',
    '{"outDir":"o","perTest":true,"issuedTestIds":["a",1]}',
  ].forEach((raw) => {
    writeFileSync(path.join(dir, controlFile), raw);

    assert.equal(readServerControl(dir), undefined, raw);
  });
  assert.deepEqual(parseServerControl('{"outDir":"o","perTest":true}'), {
    outDir: 'o',
    perTest: true,
    activeMutant: undefined,
    hitLimit: undefined,
  });
});

test('hooked marks are found and forgotten, and nothing else in the folder is touched', (t) => {
  const dir = tempTree(t, 'server-hooked-', { [controlFile]: '{}' });

  assert.equal(anyHooked(dir), false);

  writeFileSync(path.join(dir, `${hookedPrefix}12`), '');

  assert.equal(anyHooked(dir), true);

  forgetHooked(dir);

  assert.equal(anyHooked(dir), false);
  assert.deepEqual(readdirSync(dir), [controlFile]);
});

test('a host key names every loopback host as localhost and fills in the default port', () => {
  assert.equal(hostKey(new URL('http://localhost:4820/a')), 'localhost:4820');
  assert.equal(hostKey(new URL('http://127.0.0.1:4820')), 'localhost:4820');
  assert.equal(hostKey(new URL('http://[::1]:4820')), 'localhost:4820');
  assert.equal(hostKey(new URL('http://app.test/x')), 'app.test:80');
  assert.equal(hostKey(new URL('https://app.test/x')), 'app.test:443');
});

test('a host key names the any-addresses 0.0.0.0 and [::] as localhost, like the loopback hosts', () => {
  assert.equal(hostKey(new URL('http://0.0.0.0:4820/a')), 'localhost:4820');
  assert.equal(hostKey(new URL('http://[::]:4820/a')), 'localhost:4820');
});

test('an untagged key carries its arrival time, and no other key reads as untagged', () => {
  assert.equal(untaggedArrival(untaggedKey(1700000000123)), 1700000000123);
  assert.equal(untaggedArrival('a1b2-c3'), undefined);
  assert.equal(untaggedArrival(untaggedKey(1).slice(0, -1)), undefined);
  assert.equal(untaggedArrival(`${untaggedKey(1)}x`), undefined);
  assert.equal(untaggedArrival(`${untaggedPrefix}x1`), undefined);
  assert.equal(
    untaggedArrival('1'.repeat(untaggedPrefix.length + 1)),
    undefined,
  );
});
