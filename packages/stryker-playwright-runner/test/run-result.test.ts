// How a finished Playwright run maps to a Stryker result, without a browser.
// Run: node --test packages/stryker-playwright-runner/test/run-result.test.ts
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type {
  FullResult,
  Suite,
  TestCase,
  TestResult,
} from '@playwright/test/reporter';
import {
  INSTRUMENTER_CONSTANTS,
  type MutantCoverage,
  type StrykerOptions,
} from '@stryker-mutator/api/core';
import type { Logger } from '@stryker-mutator/api/logging';
import {
  DryRunStatus,
  type MutantRunOptions,
  MutantRunStatus,
  TestStatus,
} from '@stryker-mutator/api/test-runner';

import {
  PlaywrightTestRunner,
  withEnv,
} from '../src/playwright-test-runner.ts';
import {
  parseSnapshotLine,
  RUN_SETTINGS,
  serializeSnapshot,
  type Snapshot,
  type SnapshotLine,
} from '../src/protocol.ts';
import { CollectingReporter } from '../src/reporter.ts';
import {
  type DryRunRequest,
  dryRunRequest,
  type MutantRunRequest,
  mutantRunRequest,
  runPlan,
} from '../src/run-request.ts';
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
  listSerialGroups,
  projectsThatRun,
  serialGroups,
  withSerialGroups,
} from '../src/serial-groups.ts';
import { DRY_RUN_BUDGET } from '../src/timeouts.ts';

type Outcome = ReturnType<TestCase['outcome']>;

const ACTIVE_MUTANT = INSTRUMENTER_CONSTANTS.ACTIVE_MUTANT_ENV_VARIABLE;

// A snapshot as the runner reads it from a line the hook wrote.
function parsed(line: Partial<SnapshotLine>): Snapshot {
  const snapshot = parseSnapshotLine(JSON.stringify(line));
  assert.ok(snapshot);

  return snapshot;
}

function merge(lines: Partial<SnapshotLine>[]) {
  return mergeCoverage(lines.map(parsed));
}

// Playwright passes the same TestCase for every attempt and appends each attempt to its results.
function attempt(
  reporter: CollectingReporter,
  id: string,
  outcome: Outcome,
  status: TestResult['status'],
  expectedStatus: TestCase['expectedStatus'] = 'passed',
) {
  const testCase =
    reporter.testCases.get(id) ??
    ({
      id,
      expectedStatus,
      results: [],
      titlePath: () => ['', 'e2e', 'app.spec.ts', id],
      location: { file: 'app.spec.ts', line: 1, column: 1 },
    } as unknown as TestCase);
  testCase.results.push({
    status,
    duration: 10,
    error: status === 'passed' ? undefined : { message: `${id} ${status}` },
  } as unknown as TestResult);
  Object.assign(testCase, { outcome: () => outcome });
  reporter.onTestEnd(testCase);
}

function classify(
  reporter: CollectingReporter,
  {
    status = 'failed',
    mutant = true,
    hookInstalled = true,
    testFilter,
  }: {
    status?: RunStatus;
    mutant?: boolean;
    hookInstalled?: boolean;
    testFilter?: string[];
  } = {},
) {
  return toRunResult(
    { status, reporter, snapshots: [], hookInstalled },
    mutant ? mutantRequest({ testFilter }) : dryRequest(),
  );
}

function dryRequest(request: Partial<DryRunRequest> = {}): DryRunRequest {
  return {
    kind: 'dry',
    disableBail: true,
    coverageAnalysis: 'perTest',
    budget: DRY_RUN_BUDGET,
    ...request,
  };
}

function mutantRequest(
  request: Partial<MutantRunRequest> = {},
): MutantRunRequest {
  return {
    kind: 'mutant',
    disableBail: true,
    activeMutant: '1',
    testFilter: undefined,
    hitLimit: undefined,
    budget: DRY_RUN_BUDGET,
    ...request,
  };
}

// The output of a run whose tests all passed, with the given snapshot lines.
function passedRun(lines: Partial<SnapshotLine>[]): RunOutput {
  const reporter = new CollectingReporter();
  attempt(reporter, 'a', 'expected', 'passed');

  return {
    status: 'passed',
    reporter,
    snapshots: lines.map(parsed),
    hookInstalled: true,
  };
}

test('a mutant run fails a test that passes only on a retry', () => {
  const reporter = new CollectingReporter();
  attempt(reporter, 'a', 'unexpected', 'failed');
  attempt(reporter, 'a', 'flaky', 'passed');

  const result = classify(reporter, { status: 'passed' });

  assert.deepEqual(
    result.status === DryRunStatus.Complete &&
      result.tests.map((t) => [
        t.id,
        t.status,
        t.status === TestStatus.Failed ? t.failureMessage : undefined,
      ]),
    [['a', TestStatus.Failed, 'a failed']],
  );
});

test('the dry run counts a test that passes on a retry as passing', () => {
  const reporter = new CollectingReporter();
  attempt(reporter, 'a', 'unexpected', 'failed');
  attempt(reporter, 'a', 'flaky', 'passed');

  const result = classify(reporter, { status: 'passed', mutant: false });

  assert.deepEqual(
    result.status === DryRunStatus.Complete &&
      result.tests.map((t) => t.status),
    [TestStatus.Success],
  );
});

test('a kill outranks a timeout in the same run', () => {
  const reporter = new CollectingReporter();
  attempt(reporter, 'a', 'unexpected', 'timedOut');
  attempt(reporter, 'b', 'unexpected', 'failed');

  assert.equal(classify(reporter).status, DryRunStatus.Complete);
});

test('a retried test that fails an assertion kills the mutant even when another attempt timed out', () => {
  const reporter = new CollectingReporter();
  attempt(reporter, 'a', 'unexpected', 'timedOut');
  attempt(reporter, 'a', 'unexpected', 'failed');

  assert.equal(classify(reporter).status, DryRunStatus.Complete);
});

test('a timeout alone makes a mutant run a Timeout', () => {
  const reporter = new CollectingReporter();
  attempt(reporter, 'a', 'unexpected', 'timedOut');
  attempt(reporter, 'b', 'expected', 'passed');

  assert.equal(classify(reporter).status, DryRunStatus.Timeout);
});

test('a test.fail() test that fails as expected is no kill, so a timeout stays a Timeout', () => {
  const reporter = new CollectingReporter();
  attempt(reporter, 'a', 'unexpected', 'timedOut');
  attempt(reporter, 'b', 'expected', 'failed', 'failed');

  assert.equal(classify(reporter).status, DryRunStatus.Timeout);
});

test('the dry run reports a timed-out test as a failed test', () => {
  const reporter = new CollectingReporter();
  attempt(reporter, 'a', 'unexpected', 'timedOut');

  const result = classify(reporter, { mutant: false });

  assert.deepEqual(
    result.status === DryRunStatus.Complete &&
      result.tests.map((t) => t.status),
    [TestStatus.Failed],
  );
});

test('a mutant run without test results is an error, filtered or not', () => {
  assert.deepEqual(
    classify(new CollectingReporter(), {
      status: 'passed',
      testFilter: ['gone', 'also gone'],
    }),
    {
      status: DryRunStatus.Error,
      errorMessage:
        'None of the 2 selected tests ran; their Playwright test ids no longer match.',
    },
  );
  assert.deepEqual(classify(new CollectingReporter(), { status: 'passed' }), {
    status: DryRunStatus.Error,
    errorMessage: 'Playwright ran no tests.',
  });
});

test('a test result is named by its title path without the empty titles', () => {
  const reporter = new CollectingReporter();
  attempt(reporter, 'a', 'expected', 'passed');
  Object.assign(reporter.testCases.get('a') ?? {}, {
    titlePath: () => ['', '', 'app.spec.ts', 'a'],
  });

  const result = classify(reporter, { status: 'passed' });

  assert.deepEqual(
    result.status === DryRunStatus.Complete && result.tests.map((t) => t.name),
    ['[app.spec.ts] › a'],
  );
});

test('a test.fail() test that passed kills the mutant, though another test timed out', () => {
  const reporter = new CollectingReporter();
  attempt(reporter, 'a', 'unexpected', 'timedOut');
  attempt(reporter, 'b', 'unexpected', 'passed', 'failed');

  assert.equal(classify(reporter).status, DryRunStatus.Complete);
});

test('a test that timed out and then passed on a retry makes a mutant run a Timeout', () => {
  const reporter = new CollectingReporter();
  attempt(reporter, 'a', 'unexpected', 'timedOut');
  attempt(reporter, 'a', 'flaky', 'passed');

  assert.equal(
    classify(reporter, { status: 'passed' }).status,
    DryRunStatus.Timeout,
  );
});

test('a timed-out test that ran without the hook is a hook error, not a Timeout', () => {
  const reporter = new CollectingReporter();
  attempt(reporter, 'a', 'unexpected', 'timedOut');

  assert.equal(
    classify(reporter, { hookInstalled: false }).status,
    DryRunStatus.Error,
  );
});

test('a failed or retried-then-failed attempt counts as failed, a skipped one does not', () => {
  const reporter = new CollectingReporter();
  attempt(reporter, 'a', 'expected', 'passed');
  attempt(reporter, 'b', 'skipped', 'skipped');

  assert.equal(attemptSummary(reporter.testCases.values()).anyFailed, false);

  attempt(reporter, 'c', 'unexpected', 'failed');
  attempt(reporter, 'c', 'flaky', 'passed');

  assert.equal(attemptSummary(reporter.testCases.values()).anyFailed, true);
});

test('a timed-out or interrupted attempt failed but killed nothing', () => {
  const reporter = new CollectingReporter();
  attempt(reporter, 'a', 'unexpected', 'timedOut');
  attempt(reporter, 'b', 'unexpected', 'interrupted');

  assert.deepEqual(attemptSummary(reporter.testCases.values()), {
    anyFailed: true,
    killed: false,
    timedOut: true,
  });
});

test('an unfiltered dry run without tests completes empty, so Stryker applies allowEmpty', () => {
  const result = classify(new CollectingReporter(), {
    status: 'passed',
    mutant: false,
  });

  assert.deepEqual(result, {
    status: DryRunStatus.Complete,
    tests: [],
    snapshots: [],
  });
});

test('a run that Playwright failed without a test or an error is an error, not an empty run', () => {
  const result = classify(new CollectingReporter(), {
    status: 'failed',
    mutant: false,
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

  assert.deepEqual(
    result.status === DryRunStatus.Complete && {
      tests: result.tests.map((t) => t.id),
      mutantCoverage: result.mutantCoverage,
    },
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

  assert.deepEqual(
    result.status === DryRunStatus.Complete && plain(result.mutantCoverage),
    { static: { '2': 1 }, perTest: { a: { '1': 3 } } },
  );
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
  assert.match(
    result.status === MutantRunStatus.Timeout ? (result.reason ?? '') : '',
    /Hit limit reached/,
  );
});

test('the hit limit counts on a run that is otherwise an error', () => {
  const output: RunOutput = {
    status: 'failed',
    reporter: new CollectingReporter(),
    snapshots: [parsed({ hitCount: 1001 })],
    hookInstalled: true,
  };

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

  assert.deepEqual(
    result.status === MutantRunStatus.Killed && result.killedBy,
    ['b'],
  );
});

test('a mutant run request widens its filter to serial groups and gets its budget', () => {
  const request = mutantRunRequest(
    {
      activeMutant: { id: '7' },
      testFilter: ['edit'],
      hitLimit: 50,
      disableBail: false,
      timeout: 8000,
    } as unknown as MutantRunOptions,
    {
      serialGroups: new Map([['edit', ['create', 'edit']]]),
      timeouts: { testTimeoutCap: Infinity, expectTimeout: 1000 },
    },
  );

  assert.deepEqual(request, {
    kind: 'mutant',
    disableBail: false,
    activeMutant: '7',
    testFilter: ['create', 'edit'],
    hitLimit: 50,
    budget: { testTimeout: 2400, deadlineMs: 5400 },
  });
});

test('a dry run request keeps the config timeouts', () => {
  assert.deepEqual(
    dryRunRequest({
      timeout: 60_000,
      disableBail: false,
      coverageAnalysis: 'all',
    }),
    {
      kind: 'dry',
      disableBail: false,
      coverageAnalysis: 'all',
      budget: { testTimeout: undefined, deadlineMs: undefined },
    },
  );
});

test('a dry run plan runs every test with no active mutant, and collects per-test coverage only for perTest', () => {
  assert.deepEqual(runPlan(dryRequest(), 'out'), {
    env: {
      [RUN_SETTINGS]: '{"outDir":"out","perTest":true}',
      [ACTIVE_MUTANT]: undefined,
    },
    params: { testIds: undefined, maxFailures: undefined, timeout: undefined },
  });
  assert.equal(
    runPlan(dryRequest({ coverageAnalysis: 'all' }), 'out').env[RUN_SETTINGS],
    '{"outDir":"out","perTest":false}',
  );
});

test('a mutant run plan activates the mutant and runs its filter in its budget, with its hit limit', () => {
  assert.deepEqual(
    runPlan(
      mutantRequest({
        activeMutant: '7',
        testFilter: ['a', 'b'],
        hitLimit: 5,
        budget: { testTimeout: 900, deadlineMs: 1000 },
      }),
      'out',
    ),
    {
      env: {
        [RUN_SETTINGS]: '{"outDir":"out","perTest":false,"hitLimit":5}',
        [ACTIVE_MUTANT]: '7',
      },
      params: { testIds: ['a', 'b'], maxFailures: undefined, timeout: 900 },
    },
  );
});

test('a run plan stops at the first failure unless bail is disabled', () => {
  assert.equal(
    runPlan(dryRequest({ disableBail: false }), 'out').params.maxFailures,
    1,
  );
  assert.equal(
    runPlan(mutantRequest({ disableBail: false }), 'out').params.maxFailures,
    1,
  );
});

test('a run leaves no run settings behind in the environment, also when it throws', async () => {
  process.env.WITH_ENV_KEPT = 'before';
  delete process.env.WITH_ENV_ADDED;

  try {
    const seen = await withEnv(
      { WITH_ENV_KEPT: undefined, WITH_ENV_ADDED: 'during' },
      async () => [process.env.WITH_ENV_KEPT, process.env.WITH_ENV_ADDED],
    );

    assert.deepEqual(seen, [undefined, 'during']);
    assert.equal(process.env.WITH_ENV_KEPT, 'before');
    assert.equal('WITH_ENV_ADDED' in process.env, false);

    await assert.rejects(
      withEnv({ WITH_ENV_KEPT: 'during' }, async () => {
        throw new Error('run failed');
      }),
      { message: 'run failed' },
    );
    assert.equal(process.env.WITH_ENV_KEPT, 'before');
  } finally {
    delete process.env.WITH_ENV_KEPT;
  }
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
  const output: RunOutput = {
    status: 'deadline',
    reporter: new CollectingReporter(),
    snapshots: [],
    hookInstalled: false,
  };

  assert.equal(
    toRunResult(output, mutantRequest({ testFilter: ['a'] })).status,
    DryRunStatus.Timeout,
  );
  assert.equal(toRunResult(output, dryRequest()).status, DryRunStatus.Timeout);
});

test('a deadline stop that interrupted the looping test is a Timeout', () => {
  const reporter = new CollectingReporter();
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

  assert.deepEqual(
    result.status === MutantRunStatus.Killed && result.killedBy,
    ['b'],
  );
});

test('a run someone else interrupted stays an error', () => {
  const reporter = new CollectingReporter();
  attempt(reporter, 'a', 'skipped', 'interrupted');

  assert.equal(
    classify(reporter, { status: 'interrupted' }).status,
    DryRunStatus.Error,
  );
});

test('the missing-coverage error names lost frames when every frame was lost', () => {
  const passed = {
    id: 'a',
    name: 'a',
    status: TestStatus.Success,
    timeSpentMs: 10,
  } as const;

  assert.match(
    missingCoverageError(
      [passed],
      [parsed({ lost: true }), parsed({ lost: true })],
    ) ?? '',
    /all 2 frame\(s\) did not answer/,
  );
});

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

test('the missing-coverage error says no instrumented code ran instead of blaming the webServer', () => {
  const passed = {
    id: 'a',
    name: 'a',
    status: TestStatus.Success,
    timeSpentMs: 10,
  } as const;

  assert.equal(
    missingCoverageError([passed], []),
    'Tests ran, but no instrumented code ran, neither in a page nor in a Playwright worker. The dry run needs at least one test that runs the app code, in a page or by importing it.',
  );
});

test('the missing-coverage error blames the webServer when pages answered without instrumented code', () => {
  const passed = {
    id: 'a',
    name: 'a',
    status: TestStatus.Success,
    timeSpentMs: 10,
  } as const;
  const blame =
    'No page loaded instrumented code. Is the webServer serving the Stryker sandbox? A server that was already running (reuseExistingServer) serves the original sources.';

  assert.equal(missingCoverageError([passed], [parsed({})]), blame);
  assert.equal(
    missingCoverageError([passed], [parsed({ lost: true }), parsed({})]),
    blame,
  );
});

test('the reporter keeps the last 4000 characters of stdout and stderr, and prints nothing itself', () => {
  const reporter = new CollectingReporter();

  reporter.onStdOut('a'.repeat(3998));
  reporter.onStdErr(Buffer.from('bcd'));

  assert.equal(reporter.printsToStdio(), false);
  assert.equal(reporter.outputTail, `${'a'.repeat(3997)}bcd`);
});

test('a run with errors and no failed test is an error, with every error', () => {
  const reporter = new CollectingReporter();
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
  const reporter = new CollectingReporter();
  attempt(reporter, 'a', 'unexpected', 'failed');
  attempt(reporter, 'b', 'expected', 'passed');
  reporter.onError({ message: 'worker teardown' });

  assert.equal(classify(reporter).status, DryRunStatus.Complete);
});

test('coverage from a Playwright worker alone satisfies the dry run', () => {
  const passed = {
    id: 'a',
    name: 'a',
    status: TestStatus.Success,
    timeSpentMs: 10,
  } as const;

  assert.equal(
    missingCoverageError(
      [passed],
      [parsed({ mutantCoverage: { static: { '1': 1 }, perTest: {} } })],
    ),
    undefined,
  );
});

test('the missing-coverage error needs a test that ran, and none that failed', () => {
  const result = (id: string, status: TestStatus) =>
    ({ id, name: id, status, timeSpentMs: 10 }) as Parameters<
      typeof missingCoverageError
    >[0][number];
  const skipped = result('a', TestStatus.Skipped);
  const passed = result('b', TestStatus.Success);
  const failed = result('c', TestStatus.Failed);

  assert.equal(missingCoverageError([skipped], []), undefined);
  assert.match(
    missingCoverageError([skipped, passed], []) ?? '',
    /no instrumented code ran/,
  );
  assert.equal(missingCoverageError([passed, failed], []), undefined);
});

test('a run of skipped tests needs no hook', () => {
  const reporter = new CollectingReporter();
  attempt(reporter, 'a', 'skipped', 'skipped');

  assert.equal(
    classify(reporter, { status: 'passed', hookInstalled: false }).status,
    DryRunStatus.Complete,
  );
});

test('tests that ran without the hook are an error', () => {
  const reporter = new CollectingReporter();
  attempt(reporter, 'a', 'skipped', 'skipped');
  attempt(reporter, 'b', 'expected', 'passed');

  assert.equal(
    classify(reporter, { status: 'passed', hookInstalled: false }).status,
    DryRunStatus.Error,
  );
});

test('a mutant run selects every test of a describe.serial group, not one test alone', () => {
  const file = { _parallelMode: 'none', parent: undefined };
  const serial = { _parallelMode: 'serial', parent: file };
  const nestedSerial = { _parallelMode: 'serial', parent: serial };
  const plain = { _parallelMode: 'default', parent: file };
  const testCase = (id: string, parent: object) =>
    ({ id, parent }) as unknown as TestCase;
  const groups = serialGroups([
    testCase('create', serial),
    testCase('edit', nestedSerial),
    testCase('alone', plain),
  ]);

  assert.deepEqual(withSerialGroups(['edit'], groups), ['create', 'edit']);
  assert.deepEqual(withSerialGroups(['alone', 'create'], groups), [
    'alone',
    'create',
    'edit',
  ]);
  assert.equal(withSerialGroups(undefined, groups), undefined);
});

test('serial grouping fails loudly when Playwright suites lose _parallelMode', () => {
  const renamed = { parent: undefined } as unknown as Suite;

  assert.throws(
    () => serialGroups([{ id: 'a', parent: renamed } as unknown as TestCase]),
    { message: /Suite\._parallelMode/ },
  );
});

// Stands in for Playwright's TestRunner: reports the given errors and tests, then resolves to result.
function listing(
  result: { status: FullResult['status'] } | undefined,
  errors: string[] = [],
  tests: TestCase[] = [],
) {
  const calls: string[][] = [];
  const playwright = {
    async listTests(
      reporter: CollectingReporter,
      params: { projects?: string[] },
    ) {
      calls.push(params.projects ?? []);
      errors.forEach((message) => reporter.onError({ message }));
      reporter.onBegin(undefined, {
        allTests: () => tests,
      } as unknown as Suite);

      return result;
    },
  };

  return { playwright, calls };
}

test('without a projects option, listing covers the default projects, which are what a run runs', () => {
  const projects = [
    { default: true, project: { name: 'chromium' } },
    { default: false, project: { name: 'smoke' } },
    { default: true, project: { name: 'setup' } },
  ];

  assert.deepEqual(projectsThatRun(undefined, projects), ['chromium', 'setup']);
  assert.deepEqual(projectsThatRun([], projects), ['chromium', 'setup']);
  assert.deepEqual(projectsThatRun(['smoke'], projects), ['smoke']);
});

test('listing passes the projects to Playwright and groups the describe.serial tests it lists', async () => {
  const serial = { _parallelMode: 'serial', parent: undefined };
  const tests = ['create', 'edit'].map(
    (id) => ({ id, parent: serial }) as unknown as TestCase,
  );
  const { playwright, calls } = listing({ status: 'passed' }, [], tests);

  const groups = await listSerialGroups(playwright, ['chromium']);

  assert.deepEqual(groups.get('edit'), ['create', 'edit']);
  assert.deepEqual(calls, [['chromium']]);
});

test('listing fails when a test file does not load, though the status says passed', async () => {
  const { playwright } = listing({ status: 'passed' }, [
    'SyntaxError in a.spec.ts',
    'SyntaxError in b.spec.ts',
  ]);

  await assert.rejects(listSerialGroups(playwright, []), {
    message:
      'Playwright could not load every test file:\nSyntaxError in a.spec.ts\nSyntaxError in b.spec.ts',
  });
});

test('listing fails with the status Playwright reports', async () => {
  const { playwright } = listing({ status: 'failed' }, [
    'config error',
    'second error',
  ]);

  await assert.rejects(listSerialGroups(playwright, []), {
    message:
      'Playwright could not list the tests (failed):\nconfig error\nsecond error',
  });
});

test('listing fails and points at the trace log when Playwright throws', async () => {
  const { playwright } = listing(undefined);

  await assert.rejects(listSerialGroups(playwright, []), {
    message: /--logLevel trace/,
  });
});

test('init refuses --testFiles before it loads the Playwright config', async () => {
  const options = {
    testFiles: ['a.spec.ts'],
    timeoutMS: 10_000,
    playwright: { configFile: 'missing.playwright.config.ts' },
  };
  const runner = new PlaywrightTestRunner(
    options as unknown as StrykerOptions,
    {} as Logger,
  );

  await assert.rejects(runner.init(), { message: /--testFiles/ });
});

test('a page cannot reach Object.prototype through a __proto__ test id in its coverage', () => {
  const perTest = JSON.parse('{ "__proto__": { "1": 1 } }') as Record<
    string,
    Record<string, number>
  >;

  try {
    const coverage = merge([{ mutantCoverage: { static: {}, perTest } }]);

    assert.equal(({} as Record<string, unknown>)['1'], undefined);
    assert.deepEqual({ ...coverage.perTest['__proto__'] }, { '1': 1 });
  } finally {
    delete (Object.prototype as Record<string, unknown>)['1'];
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

// mergeCoverage builds null-prototype maps, which deepEqual tells apart from object literals.
function plain(coverage: MutantCoverage | undefined): MutantCoverage {
  return JSON.parse(JSON.stringify(coverage)) as MutantCoverage;
}

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
