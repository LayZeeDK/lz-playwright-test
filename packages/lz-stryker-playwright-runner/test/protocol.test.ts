import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  parseSnapshotLine,
  readRunSettings,
  RUN_SETTINGS,
  serializeSnapshot,
} from '../src/protocol.ts';
import { plain } from './support/doubles.ts';

test('a snapshot with a BigInt hit count is written as a lost frame', () => {
  const line = serializeSnapshot({ hitCount: 1n, outlivedItsTest: true });

  assert.deepEqual(JSON.parse(line), { lost: true, outlivedItsTest: true });
  assert.equal(parseSnapshotLine(line)?.lost, true);
});

test('a snapshot with cyclic coverage is written as a lost frame', () => {
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;

  assert.deepEqual(
    JSON.parse(
      serializeSnapshot({ mutantCoverage: cyclic, outlivedItsTest: true }),
    ),
    {
      lost: true,
      outlivedItsTest: true,
    },
  );
});

test('a line that is cut off or not an object is skipped', () => {
  assert.equal(parseSnapshotLine('{"mutantCoverage":{"sta'), undefined);
  assert.equal(parseSnapshotLine('3'), undefined);
  assert.equal(parseSnapshotLine('null'), undefined);
});

test('a parsed line sets every flag and a valid hit count', () => {
  assert.deepEqual(parseSnapshotLine('{}'), {
    coverage: undefined,
    hitCount: 0,
    outlivedItsTest: false,
    lost: false,
  });
  assert.equal(parseSnapshotLine('{"hitCount":-1}')?.hitCount, 0);
  assert.equal(parseSnapshotLine('{"hitCount":"3"}')?.hitCount, 0);
  assert.equal(parseSnapshotLine('{"hitCount":7}')?.hitCount, 7);
  assert.deepEqual(parseSnapshotLine('{"lost":true,"outlivedItsTest":true}'), {
    coverage: undefined,
    hitCount: 0,
    outlivedItsTest: true,
    lost: true,
  });
});

test('a parsed line keeps no coverage that is not a map', () => {
  assert.equal(parseSnapshotLine('{"mutantCoverage":3}')?.coverage, undefined);
  assert.deepEqual(
    plain(
      parseSnapshotLine('{"mutantCoverage":{"static":3,"perTest":{"a":3}}}')
        ?.coverage,
    ),
    { static: {}, perTest: { a: {} } },
  );
});

test('the run settings are read from the environment, with a hit limit only when one is set', () => {
  assert.equal(readRunSettings({}), undefined);
  assert.deepEqual(
    readRunSettings({ [RUN_SETTINGS]: '{"outDir":"out","perTest":true}' }),
    { outDir: 'out', perTest: true },
  );
  assert.deepEqual(
    readRunSettings({
      [RUN_SETTINGS]: '{"outDir":"out","perTest":false,"hitLimit":5}',
    }),
    { outDir: 'out', perTest: false, hitLimit: 5 },
  );
});

test('run settings that are not JSON, not an object or have a field of the wrong type are refused', () => {
  [
    '{oops',
    'null',
    '[]',
    '{"perTest":true}',
    '{"outDir":"out"}',
    '{"outDir":"out","perTest":"true"}',
    '{"outDir":"out","perTest":true,"hitLimit":"5"}',
  ].forEach((raw) => {
    assert.throws(() => readRunSettings({ [RUN_SETTINGS]: raw }), {
      message: `${RUN_SETTINGS} holds no valid run settings: ${raw}`,
    });
  });
});

test('run settings that are not JSON are refused with the parse error as the cause', () => {
  assert.throws(
    () => readRunSettings({ [RUN_SETTINGS]: '{oops' }),
    (error) => error instanceof Error && error.cause instanceof SyntaxError,
  );
});
