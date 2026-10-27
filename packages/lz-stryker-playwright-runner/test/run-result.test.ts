// How a finished Playwright run maps to a Stryker result, without a browser.
// Run: node --test packages/lz-stryker-playwright-runner/test/run-result.test.ts
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { TestCase, TestResult } from '@playwright/test/reporter';
import {
  type DryRunResult,
  DryRunStatus,
  type MutantRunResult,
  MutantRunStatus,
  type TestResult as StrykerTestResult,
  TestStatus,
} from '@stryker-mutator/api/test-runner';

import {
  parseSnapshotLine,
  type Snapshot,
  type SnapshotLine,
} from '../src/protocol.ts';
import { LzStrykerCollectingReporter } from '../src/reporter.ts';
import type { RunRequest } from '../src/run-request.ts';
import {
  attemptSummary,
  coverageGaps,
  dryRunResult,
  mayHaveLostItsServer,
  mergeCoverage,
  missingCoverageError,
  mutantRunResult,
  type RunOutput,
  type RunStatus,
  toRunResult,
} from '../src/run-result.ts';
import {
  addAttempt,
  dryRequest,
  fakeTestCase,
  mutantRequest,
  type Outcome,
  plain,
  runOutput,
} from './support/doubles.ts';

// A snapshot as the runner reads it from a line the hook wrote.
function parsed(line: Partial<SnapshotLine>): Snapshot {
  const snapshot = parseSnapshotLine(JSON.stringify(line));
  assert.ok(snapshot);

  return snapshot;
}

function merge(lines: Partial<SnapshotLine>[]) {
  return mergeCoverage(lines.map(parsed));
}

// Playwright reports a test again after each attempt, with every attempt so far in its results.
function attempt(
  reporter: LzStrykerCollectingReporter,
  id: string,
  outcome: Outcome,
  status: TestResult['status'],
  expectedStatus: TestCase['expectedStatus'] = 'passed',
) {
  const testCase =
    reporter.testCases.get(id) ?? fakeTestCase(id, { expectedStatus });
  reporter.onTestEnd(addAttempt(testCase, outcome, status));
}

function classify(
  reporter: LzStrykerCollectingReporter,
  {
    status = 'failed',
    hookInstalled = true,
    request = mutantRequest(),
  }: {
    status?: RunStatus;
    hookInstalled?: boolean;
    request?: RunRequest;
  } = {},
) {
  return toRunResult(runOutput({ status, reporter, hookInstalled }), request);
}

const passedTest = {
  id: 'a',
  name: 'a',
  status: TestStatus.Success,
  timeSpentMs: 10,
} as const;

function completed(result: DryRunResult) {
  assert.equal(result.status, DryRunStatus.Complete);

  return result;
}

function killed(result: MutantRunResult) {
  assert.equal(result.status, MutantRunStatus.Killed);

  return result;
}

// The output of a run whose tests all passed, with the given snapshot lines.
function passedRun(lines: Partial<SnapshotLine>[]): RunOutput {
  const reporter = new LzStrykerCollectingReporter();
  attempt(reporter, 'a', 'expected', 'passed');

  return runOutput({ reporter, snapshots: lines.map(parsed) });
}

test('a mutant run fails a test that passes only on a retry', () => {
  const reporter = new LzStrykerCollectingReporter();
  attempt(reporter, 'a', 'unexpected', 'failed');
  attempt(reporter, 'a', 'flaky', 'passed');

  const result = classify(reporter, { status: 'passed' });

  assert.deepEqual(
    completed(result).tests.map((t) => [
      t.id,
      t.status,
      t.status === TestStatus.Failed ? t.failureMessage : undefined,
    ]),
    [['a', TestStatus.Failed, 'a failed']],
  );
});

test('the dry run counts a test that passes on a retry as passing', () => {
  const reporter = new LzStrykerCollectingReporter();
  attempt(reporter, 'a', 'unexpected', 'failed');
  attempt(reporter, 'a', 'flaky', 'passed');

  const result = classify(reporter, {
    status: 'passed',
    request: dryRequest(),
  });

  assert.deepEqual(
    completed(result).tests.map((t) => t.status),
    [TestStatus.Success],
  );
});

test('a kill outranks a timeout in the same run', () => {
  const reporter = new LzStrykerCollectingReporter();
  attempt(reporter, 'a', 'unexpected', 'timedOut');
  attempt(reporter, 'b', 'unexpected', 'failed');

  assert.equal(classify(reporter).status, DryRunStatus.Complete);
});

test('a retried test that fails an assertion kills the mutant even when another attempt timed out', () => {
  const reporter = new LzStrykerCollectingReporter();
  attempt(reporter, 'a', 'unexpected', 'timedOut');
  attempt(reporter, 'a', 'unexpected', 'failed');

  assert.equal(classify(reporter).status, DryRunStatus.Complete);
});

test('a timeout alone makes a mutant run a Timeout', () => {
  const reporter = new LzStrykerCollectingReporter();
  attempt(reporter, 'a', 'unexpected', 'timedOut');
  attempt(reporter, 'b', 'expected', 'passed');

  assert.equal(classify(reporter).status, DryRunStatus.Timeout);
});

test('a test.fail() test that fails as expected is no kill, so a timeout stays a Timeout', () => {
  const reporter = new LzStrykerCollectingReporter();
  attempt(reporter, 'a', 'unexpected', 'timedOut');
  attempt(reporter, 'b', 'expected', 'failed', 'failed');

  assert.equal(classify(reporter).status, DryRunStatus.Timeout);
});

test('the dry run reports a timed-out test as a failed test', () => {
  const reporter = new LzStrykerCollectingReporter();
  attempt(reporter, 'a', 'unexpected', 'timedOut');

  const result = classify(reporter, { request: dryRequest() });

  assert.deepEqual(
    completed(result).tests.map((t) => t.status),
    [TestStatus.Failed],
  );
});

test('a mutant run without test results is an error, filtered or not', () => {
  assert.deepEqual(
    classify(new LzStrykerCollectingReporter(), {
      status: 'passed',
      request: mutantRequest({ testFilter: ['gone', 'also gone'] }),
    }),
    {
      status: DryRunStatus.Error,
      errorMessage:
        'None of the 2 selected tests ran; their Playwright test ids no longer match.',
    },
  );
  assert.deepEqual(
    classify(new LzStrykerCollectingReporter(), { status: 'passed' }),
    {
      status: DryRunStatus.Error,
      errorMessage: 'Playwright ran no tests.',
    },
  );
});

test('a test result is named by its title path without the empty titles', () => {
  const reporter = new LzStrykerCollectingReporter();
  attempt(reporter, 'a', 'expected', 'passed');
  Object.assign(reporter.testCases.get('a') ?? {}, {
    titlePath: () => ['', '', 'app.spec.ts', 'a'],
  });

  const result = classify(reporter, { status: 'passed' });

  assert.deepEqual(
    completed(result).tests.map((t) => t.name),
    ['[app.spec.ts] › a'],
  );
});

test('a test.fail() test that passed kills the mutant, though another test timed out', () => {
  const reporter = new LzStrykerCollectingReporter();
  attempt(reporter, 'a', 'unexpected', 'timedOut');
  attempt(reporter, 'b', 'unexpected', 'passed', 'failed');

  assert.equal(classify(reporter).status, DryRunStatus.Complete);
});

test('a test that timed out and then passed on a retry makes a mutant run a Timeout', () => {
  const reporter = new LzStrykerCollectingReporter();
  attempt(reporter, 'a', 'unexpected', 'timedOut');
  attempt(reporter, 'a', 'flaky', 'passed');

  assert.equal(
    classify(reporter, { status: 'passed' }).status,
    DryRunStatus.Timeout,
  );
});

test('a timed-out test that ran without the hook is a hook error, not a Timeout', () => {
  const reporter = new LzStrykerCollectingReporter();
  attempt(reporter, 'a', 'unexpected', 'timedOut');

  assert.equal(
    classify(reporter, { hookInstalled: false }).status,
    DryRunStatus.Error,
  );
});

test('a failed or retried-then-failed attempt counts as failed, a skipped one does not', () => {
  const reporter = new LzStrykerCollectingReporter();
  attempt(reporter, 'a', 'expected', 'passed');
  attempt(reporter, 'b', 'skipped', 'skipped');

  assert.equal(attemptSummary(reporter.testCases.values()).anyFailed, false);

  attempt(reporter, 'c', 'unexpected', 'failed');
  attempt(reporter, 'c', 'flaky', 'passed');

  assert.equal(attemptSummary(reporter.testCases.values()).anyFailed, true);
});

test('a timed-out or interrupted attempt failed but killed nothing', () => {
  const reporter = new LzStrykerCollectingReporter();
  attempt(reporter, 'a', 'unexpected', 'timedOut');
  attempt(reporter, 'b', 'unexpected', 'interrupted');

  assert.deepEqual(attemptSummary(reporter.testCases.values()), {
    anyFailed: true,
    killed: false,
    timedOut: true,
  });
});

test('an unfiltered dry run without tests completes empty, so Stryker applies allowEmpty', () => {
  const result = classify(new LzStrykerCollectingReporter(), {
    status: 'passed',
    request: dryRequest(),
  });

  assert.deepEqual(result, {
    status: DryRunStatus.Complete,
    tests: [],
    snapshots: [],
  });
});

test('a run that Playwright failed without a test or an error is an error, not an empty run', () => {
  const result = classify(new LzStrykerCollectingReporter(), {
    status: 'failed',
    request: dryRequest(),
  });

  assert.deepEqual(result, {
    status: DryRunStatus.Error,
    errorMessage:
      'Playwright failed without running a test; rerun Stryker with --logLevel trace to see its error.',
  });
});

test('a dry run with coverage off still fails when no page loaded instrumented code', () => {
  const { result, gaps } = dryRunResult(
    passedRun([]),
    dryRequest({ coverageAnalysis: 'off' }),
  );

  assert.equal(result.status, DryRunStatus.Error);
  assert.equal(gaps, undefined);
});

test('a dry run with coverage off reports the tests and no coverage', () => {
  const { result, gaps } = dryRunResult(
    passedRun([{ mutantCoverage: { static: { '1': 1 }, perTest: {} } }]),
    dryRequest({ coverageAnalysis: 'off' }),
  );

  const { tests, mutantCoverage } = completed(result);

  assert.deepEqual(
    { tests: tests.map((t) => t.id), mutantCoverage },
    { tests: ['a'], mutantCoverage: undefined },
  );
  assert.equal(gaps, undefined);
});

test('a dry run merges the coverage of every snapshot exactly and reports the gaps', () => {
  const { result, gaps } = dryRunResult(
    passedRun([
      {
        outlivedItsTest: false,
        mutantCoverage: { static: {}, perTest: { a: { '1': 1 } } },
      },
      {
        outlivedItsTest: true,
        mutantCoverage: { static: {}, perTest: { b: { '2': 1 } } },
      },
      {
        outlivedItsTest: false,
        mutantCoverage: { static: {}, perTest: { a: { '1': 1 } } },
      },
      { mutantCoverage: { static: {}, perTest: { a: { '1': 1 } } } },
      { lost: true, outlivedItsTest: false },
    ]),
    dryRequest(),
  );

  assert.deepEqual(plain(completed(result).mutantCoverage), {
    static: { '2': 1 },
    perTest: { a: { '1': 3 } },
  });
  assert.deepEqual(gaps, { lostFrames: 1, sharedFrames: 1 });
});

test('a dry run that fails before the merge reports no gaps', () => {
  const output = passedRun([{ lost: true, outlivedItsTest: false }]);

  assert.deepEqual(
    dryRunResult({ ...output, status: 'interrupted' }, dryRequest()),
    {
      result: {
        status: DryRunStatus.Error,
        errorMessage: 'The Playwright run was interrupted',
      },
      gaps: undefined,
    },
  );
});

test('the coverage gaps count lost frames and shared frames with coverage', () => {
  assert.deepEqual(
    coverageGaps(
      [
        { lost: true, outlivedItsTest: true },
        { outlivedItsTest: true },
        { outlivedItsTest: true, mutantCoverage: { static: {}, perTest: {} } },
        { mutantCoverage: { static: {}, perTest: {} } },
      ].map(parsed),
    ),
    { lostFrames: 1, sharedFrames: 1 },
  );
});

test('the hit limit outranks a kill, summed over every snapshot', () => {
  const output = passedRun([{ hitCount: 600 }, { hitCount: 500 }]);
  attempt(output.reporter, 'b', 'unexpected', 'failed');

  const { result, hitCount } = mutantRunResult(
    output,
    mutantRequest({ hitLimit: 1000 }),
  );

  assert.equal(hitCount, 1100);
  assert.equal(result.status, MutantRunStatus.Timeout);
  assert.match(result.reason ?? '', /Hit limit reached/);
});

test('the hit limit counts on a run that is otherwise an error', () => {
  const output = runOutput({
    status: 'failed',
    snapshots: [parsed({ hitCount: 1001 })],
  });

  assert.equal(
    mutantRunResult(output, mutantRequest({ hitLimit: 1000 })).result.status,
    MutantRunStatus.Timeout,
  );
  assert.equal(
    mutantRunResult(output, mutantRequest()).result.status,
    MutantRunStatus.Error,
  );
});

test('a mutant run under its hit limit reports the kill', () => {
  const output = passedRun([{ hitCount: 10 }]);
  attempt(output.reporter, 'b', 'unexpected', 'failed');

  const { result } = mutantRunResult(output, mutantRequest({ hitLimit: 1000 }));

  assert.deepEqual(killed(result).killedBy, ['b']);
});

test('a run with a failed attempt may have lost its server', () => {
  const failed = passedRun([]);
  attempt(failed.reporter, 'b', 'unexpected', 'failed');

  assert.equal(mayHaveLostItsServer(failed), true);
  assert.equal(mayHaveLostItsServer(passedRun([])), false);
});

test('a run the deadline stopped is never rerun, though its stopped test counts as failed', () => {
  const stopped = passedRun([]);
  attempt(stopped.reporter, 'b', 'skipped', 'interrupted');

  assert.equal(mayHaveLostItsServer(stopped), true);
  assert.equal(mayHaveLostItsServer({ ...stopped, status: 'deadline' }), false);
});

test('a deadline stop during config load, before any test, is a Timeout', () => {
  const output = runOutput({ status: 'deadline', hookInstalled: false });

  assert.equal(
    toRunResult(output, mutantRequest({ testFilter: ['a'] })).status,
    DryRunStatus.Timeout,
  );
  assert.equal(toRunResult(output, dryRequest()).status, DryRunStatus.Timeout);
});

test('a deadline stop that interrupted the looping test is a Timeout', () => {
  const reporter = new LzStrykerCollectingReporter();
  attempt(reporter, 'a', 'expected', 'passed');
  attempt(reporter, 'b', 'skipped', 'interrupted');

  assert.deepEqual(classify(reporter, { status: 'deadline' }), {
    status: DryRunStatus.Timeout,
    reason: "The run reached the runner's deadline before Stryker's timeout",
  });
});

test('a deadline stop after a test killed the mutant reports the kill', () => {
  const output = passedRun([]);
  attempt(output.reporter, 'b', 'unexpected', 'failed');
  attempt(output.reporter, 'c', 'skipped', 'interrupted');

  const { result } = mutantRunResult(
    { ...output, status: 'deadline' },
    mutantRequest({ testFilter: ['a', 'b', 'c'] }),
  );

  assert.deepEqual(killed(result).killedBy, ['b']);
});

test('a run someone else interrupted stays an error', () => {
  const reporter = new LzStrykerCollectingReporter();
  attempt(reporter, 'a', 'skipped', 'interrupted');

  assert.equal(
    classify(reporter, { status: 'interrupted' }).status,
    DryRunStatus.Error,
  );
});

test('the missing-coverage error names lost frames when every frame was lost', () => {
  assert.match(
    missingCoverageError(
      [passedTest],
      [parsed({ lost: true }), parsed({ lost: true })],
    ) ?? '',
    /all 2 frame\(s\) did not answer/,
  );
});

test('the missing-coverage error says no instrumented code ran instead of blaming the webServer', () => {
  assert.equal(
    missingCoverageError([passedTest], []),
    'Tests ran, but no instrumented code ran, neither in a page nor in a Playwright worker. The dry run needs at least one test that runs the app code, in a page or by importing it.',
  );
});

test('the missing-coverage error blames the webServer when pages answered without instrumented code', () => {
  const blame =
    'No page loaded instrumented code. Is the webServer serving the Stryker sandbox? A server that was already running (reuseExistingServer) serves the original sources.';

  assert.equal(missingCoverageError([passedTest], [parsed({})]), blame);
  assert.equal(
    missingCoverageError([passedTest], [parsed({ lost: true }), parsed({})]),
    blame,
  );
});

test('a run with errors and no failed test is an error, with every error', () => {
  const reporter = new LzStrykerCollectingReporter();
  attempt(reporter, 'a', 'expected', 'passed');
  reporter.onError({ message: 'first' });
  reporter.onError({ value: 'second' });
  reporter.onError({});

  assert.deepEqual(classify(reporter, { status: 'passed' }), {
    status: DryRunStatus.Error,
    errorMessage: 'first\nsecond\nTest failed',
  });
});

test('a failed test outranks the errors of its run', () => {
  const reporter = new LzStrykerCollectingReporter();
  attempt(reporter, 'a', 'unexpected', 'failed');
  attempt(reporter, 'b', 'expected', 'passed');
  reporter.onError({ message: 'worker teardown' });

  assert.equal(classify(reporter).status, DryRunStatus.Complete);
});

test('coverage from a Playwright worker alone satisfies the dry run', () => {
  assert.equal(
    missingCoverageError(
      [passedTest],
      [parsed({ mutantCoverage: { static: { '1': 1 }, perTest: {} } })],
    ),
    undefined,
  );
});

test('the missing-coverage error needs a test that ran, and none that failed', () => {
  const skipped: StrykerTestResult = {
    id: 'a',
    name: 'a',
    status: TestStatus.Skipped,
    timeSpentMs: 10,
  };
  const passed: StrykerTestResult = {
    id: 'b',
    name: 'b',
    status: TestStatus.Success,
    timeSpentMs: 10,
  };
  const failed: StrykerTestResult = {
    id: 'c',
    name: 'c',
    status: TestStatus.Failed,
    failureMessage: 'c failed',
    timeSpentMs: 10,
  };

  assert.equal(missingCoverageError([skipped], []), undefined);
  assert.match(
    missingCoverageError([skipped, passed], []) ?? '',
    /no instrumented code ran/,
  );
  assert.equal(missingCoverageError([passed, failed], []), undefined);
});

test('a run of skipped tests needs no hook', () => {
  const reporter = new LzStrykerCollectingReporter();
  attempt(reporter, 'a', 'skipped', 'skipped');

  assert.equal(
    classify(reporter, { status: 'passed', hookInstalled: false }).status,
    DryRunStatus.Complete,
  );
});

test('tests that ran without the hook are an error', () => {
  const reporter = new LzStrykerCollectingReporter();
  attempt(reporter, 'a', 'skipped', 'skipped');
  attempt(reporter, 'b', 'expected', 'passed');

  assert.equal(
    classify(reporter, { status: 'passed', hookInstalled: false }).status,
    DryRunStatus.Error,
  );
});

test('a page cannot reach Object.prototype through a __proto__ test id in its coverage', () => {
  const perTest: unknown = JSON.parse('{ "__proto__": { "1": 1 } }');

  try {
    const coverage = merge([{ mutantCoverage: { static: {}, perTest } }]);

    assert.equal(Reflect.get({}, '1'), undefined);
    assert.deepEqual({ ...coverage.perTest['__proto__'] }, { '1': 1 });
  } finally {
    Reflect.deleteProperty(Object.prototype, '1');
  }
});

test('a parsed line drops counts that are not hit counts, and merging sums the rest', () => {
  const hits = { '1': 2, '2': NaN, '3': -1, '4': '3', '5': null, '6': 0 };

  const coverage = merge([
    { mutantCoverage: { static: hits, perTest: { a: hits } } },
    { mutantCoverage: { static: { '1': 1 }, perTest: {} } },
  ]);

  assert.deepEqual({ ...coverage.static }, { '1': 3, '6': 0 });
  assert.deepEqual({ ...coverage.perTest['a'] }, { '1': 2, '6': 0 });
});

test('a page frame puts its per-test coverage under its test and its static coverage in static', () => {
  const coverage = merge([
    {
      outlivedItsTest: false,
      mutantCoverage: { static: { '3': 1 }, perTest: { a: { '1': 2 } } },
    },
  ]);

  assert.deepEqual(plain(coverage), {
    static: { '3': 1 },
    perTest: { a: { '1': 2 } },
  });
});

test('a frame of a shared context puts all its coverage in static', () => {
  const coverage = merge([
    {
      outlivedItsTest: true,
      mutantCoverage: { static: { '3': 1 }, perTest: { b: { '2': 1 } } },
    },
  ]);

  assert.deepEqual(plain(coverage), {
    static: { '2': 1, '3': 1 },
    perTest: {},
  });
});

test('two frames of one test sum their counts', () => {
  const frame = {
    outlivedItsTest: false,
    mutantCoverage: { static: {}, perTest: { a: { '1': 1, '2': 1 } } },
  };
  const other = {
    outlivedItsTest: false,
    mutantCoverage: { static: {}, perTest: { a: { '1': 2 } } },
  };

  assert.deepEqual(plain(merge([frame, other])), {
    static: {},
    perTest: { a: { '1': 3, '2': 1 } },
  });
});

test('a worker line with coverage and no flags merges like a page frame', () => {
  const page = {
    outlivedItsTest: false,
    mutantCoverage: { static: {}, perTest: { a: { '1': 1 } } },
  };
  const worker = {
    mutantCoverage: { static: { '4': 5 }, perTest: { a: { '1': 2 } } },
  };

  assert.deepEqual(plain(merge([page, worker])), {
    static: { '4': 5 },
    perTest: { a: { '1': 3 } },
  });
});

test('coverage from a context that outlived its test counts as static', () => {
  const coverage = merge([
    {
      outlivedItsTest: true,
      mutantCoverage: { static: {}, perTest: { a: { '1': 1 } } },
    },
  ]);

  assert.deepEqual({ ...coverage.static }, { '1': 1 });
  assert.deepEqual({ ...coverage.perTest }, {});
});

test('a run whose workers failed to install the hook reports each distinct error once', () => {
  const output: RunOutput = {
    ...passedRun([]),
    installErrors: ['Error: a', 'Error: b', 'Error: a'],
  };

  assert.deepEqual(toRunResult(output, dryRequest()), {
    status: DryRunStatus.Error,
    errorMessage:
      'The Stryker worker hook failed to install in a Playwright worker: Error: a\nError: b',
  });
});
