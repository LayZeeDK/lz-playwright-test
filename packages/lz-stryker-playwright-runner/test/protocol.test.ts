import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseSnapshotLine, serializeSnapshot } from '../src/protocol.ts';

// parseSnapshotLine builds null-prototype maps, which deepEqual tells apart from object literals.
function plain(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

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
