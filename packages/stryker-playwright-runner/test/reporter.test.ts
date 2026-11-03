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

test('the reporter raises retries at onBegin only when a project has some, and reports a suite it cannot read', () => {
  const unreadable = { allTests: () => [] };

  new LzPlaywrightCollectingReporter(new Map([['a', 0]])).onBegin(
    {},
    unreadable,
  );
  const reporter = new LzPlaywrightCollectingReporter(new Map([['a', 1]]));
  reporter.onBegin({}, unreadable);

  assert.equal(reporter.errors.length, 1);
  assert.match(reporter.errors[0] ?? '', /TestCase\.retries/);
});
