import assert from 'node:assert/strict';
import { test } from 'node:test';

import { LzPlaywrightCollectingReporter } from '../src/reporter.ts';
import { withAttempt } from './support/doubles.ts';

test('a test window runs from the start Playwright reports to the time the reporter saw the test end', () => {
  const reporter = new LzPlaywrightCollectingReporter(new Map(), () => 5900);

  reporter.onTestEnd(withAttempt('a', new Date(5000), 200));

  assert.deepEqual(reporter.windows, [{ testId: 'a', start: 5000, end: 5900 }]);
});

test('the reporter keeps the last 4000 characters of stdout and stderr, and prints nothing itself', () => {
  const reporter = new LzPlaywrightCollectingReporter();

  reporter.onStdOut('a'.repeat(3998));
  reporter.onStdErr(Buffer.from('bcd'));

  assert.equal(reporter.printsToStdio(), false);
  assert.equal(reporter.outputTail, `${'a'.repeat(3997)}bcd`);
});

test('the reporter raises retries at onBegin only when a project has some, and reports a suite it cannot read', () => {
  const unreadable = { allTests: () => [] };

  const noRetries = new LzPlaywrightCollectingReporter(new Map([['a', 0]]));
  noRetries.onBegin({ failOnFlakyTests: false }, unreadable);

  assert.equal(noRetries.retriesNotRaised, undefined);

  const reporter = new LzPlaywrightCollectingReporter(new Map([['a', 1]]));
  reporter.onBegin({ failOnFlakyTests: false }, unreadable);

  assert.match(reporter.retriesNotRaised ?? '', /TestCase\.retries/);
});
