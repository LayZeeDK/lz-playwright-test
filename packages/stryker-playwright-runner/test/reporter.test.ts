import assert from 'node:assert/strict';
import { test } from 'node:test';

import { LzPlaywrightCollectingReporter } from '../src/reporter.ts';

test('the reporter keeps the last 4000 characters of stdout and stderr, and prints nothing itself', () => {
  const reporter = new LzPlaywrightCollectingReporter();

  reporter.onStdOut('a'.repeat(3998));
  reporter.onStdErr(Buffer.from('bcd'));

  assert.equal(reporter.printsToStdio(), false);
  assert.equal(reporter.outputTail, `${'a'.repeat(3997)}bcd`);
});
