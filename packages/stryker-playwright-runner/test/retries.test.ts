// The runner's retries and flaky tests against the fake Playwright install in support/fake-playwright.ts.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  DryRunStatus,
  MutantRunStatus,
} from '@stryker-mutator/api/test-runner';

import {
  addAttempt,
  dryRunOptions,
  finishedTest,
  mutantRunOptions,
} from './support/doubles.ts';
import {
  fakePlaywright,
  type Run,
  type Status,
  writeSnapshots,
} from './support/fake-playwright.ts';

test("init counts the largest project's retries, or the retries option, in the timeout warning", async (t) => {
  const fake = fakePlaywright(t, {
    projects: [
      { default: true, project: { name: 'chromium', timeout: 1, retries: 2 } },
      { default: true, project: { name: 'firefox', timeout: 1, retries: 1 } },
    ],
  });
  const fromConfig = fake.runner({ timeoutMS: 26_599 });
  const fromOption = fake.runner({
    timeoutMS: 18_599,
    lzPlaywright: { retries: 1 },
  });
  const enough = fake.runner({ timeoutMS: 26_600 });

  await fromConfig.shell.init();
  await fromOption.shell.init();
  await enough.shell.init();

  assert.match(
    fromConfig.lines.find(([level]) => level === 'warn')?.[1] ?? '',
    /below 3 attempt\(s\) .* at least 26600\.$/,
  );
  assert.match(
    fromOption.lines.find(([level]) => level === 'warn')?.[1] ?? '',
    /below 2 attempt\(s\) .* at least 18600\.$/,
  );
  assert.deepEqual(enough.lines, []);
});

test('init refuses projects that share a name but not their retries', async (t) => {
  const fake = fakePlaywright(t, {
    projects: [
      { default: true, project: { name: 'e2e', timeout: 1, retries: 2 } },
      { default: true, project: { name: 'e2e', timeout: 1, retries: 0 } },
    ],
  });
  const { shell } = fake.runner();

  await assert.rejects(
    shell.init(),
    /projects named "e2e" set different retries/,
  );
});

function oneTestPerProject(projects: readonly string[]) {
  const tests = projects.map(() => ({ retries: 0 }));
  const root = {
    allTests: () => [],
    suites: projects.map((title, index) => ({
      title,
      allTests: () => [tests[index]],
    })),
  };

  return { tests, root };
}

test("each run raises the tests' retries to their project's retries in the Playwright config", async (t) => {
  const { tests, root } = oneTestPerProject(['chromium', 'firefox']);
  const fake = fakePlaywright(t, {
    projects: [
      { default: true, project: { name: 'chromium', timeout: 1, retries: 2 } },
      { default: true, project: { name: 'firefox', timeout: 1 } },
    ],
    root,
  });
  const { shell } = fake.runner();
  await shell.init();

  await shell.dryRun(dryRunOptions());

  assert.deepEqual(tests, [{ retries: 2 }, { retries: 0 }]);
});

test('the retries option replaces the retries of every project', async (t) => {
  const { tests, root } = oneTestPerProject(['chromium', 'firefox']);
  const fake = fakePlaywright(t, {
    projects: [
      { default: true, project: { name: 'chromium', timeout: 1, retries: 2 } },
      { default: true, project: { name: 'firefox', timeout: 1 } },
    ],
    root,
  });
  const { shell } = fake.runner({ lzPlaywright: { retries: 1 } });
  await shell.init();

  await shell.mutantRun(mutantRunOptions());

  assert.deepEqual(tests, [{ retries: 1 }, { retries: 1 }]);
});

async function flakyRun(run: Run): Promise<Status> {
  run.reporter.onTestEnd(
    addAttempt(finishedTest('a', 'failed'), 'flaky', 'passed'),
  );
  writeSnapshots(run, [
    {
      mutantCoverage: { static: {}, perTest: { a: { '1': 1 } } },
      outlivedItsTest: false,
    },
  ]);

  return 'passed';
}

test('a dry run names the tests that passed only on a retry', async (t) => {
  const fake = fakePlaywright(t, { runTests: flakyRun });
  const { shell, lines } = fake.runner();
  await shell.init();

  const result = await shell.dryRun(dryRunOptions());

  assert.equal(result.status, DryRunStatus.Complete);
  assert.deepEqual(lines, [
    [
      'warn',
      '1 test(s) passed only on a retry in the dry run: [e2e] › app.spec.ts › a',
    ],
  ]);
});

test("a mutant run's test that passes only on a retry leaves a survivor", async (t) => {
  const fake = fakePlaywright(t, { runTests: flakyRun });
  const { shell } = fake.runner();
  await shell.init();

  const result = await shell.mutantRun(mutantRunOptions());

  assert.equal(result.status, MutantRunStatus.Survived);
});

test("with the config's failOnFlakyTests, a mutant run's test that passes only on a retry kills", async (t) => {
  const fake = fakePlaywright(t, {
    runTests: flakyRun,
    failOnFlakyTests: true,
  });
  const { shell } = fake.runner();
  await shell.init();

  const result = await shell.mutantRun(mutantRunOptions());

  assert.equal(result.status, MutantRunStatus.Killed);
});
