import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { FullResult } from '@playwright/test/reporter';

import { isSerialSuite } from '../src/playwright-internals.ts';
import type {
  LzPlaywrightCollectingReporter,
  ReportedTest,
} from '../src/reporter.ts';
import {
  listSerialGroups,
  projectsThatRun,
  serialGroups,
  withSerialGroups,
} from '../src/serial-groups.ts';
import { fakeTestCase } from './support/doubles.ts';

const isSerial = (suite: unknown) => isSerialSuite(suite, '1.99.0');

test('a mutant run selects every test of a describe.serial group, not one test alone', () => {
  const file = { _parallelMode: 'none', parent: undefined };
  const serial = { _parallelMode: 'serial', parent: file };
  const nestedSerial = { _parallelMode: 'serial', parent: serial };
  const plain = { _parallelMode: 'default', parent: file };
  const groups = serialGroups(
    [
      fakeTestCase('create', { parent: serial }),
      fakeTestCase('edit', { parent: nestedSerial }),
      fakeTestCase('alone', { parent: plain }),
    ],
    isSerial,
  );

  assert.deepEqual(withSerialGroups(['edit'], groups), ['create', 'edit']);
  assert.deepEqual(withSerialGroups(['alone', 'create'], groups), [
    'alone',
    'create',
    'edit',
  ]);
});

test('serial grouping fails loudly when Playwright suites lose _parallelMode', () => {
  assert.throws(
    () =>
      serialGroups(
        [fakeTestCase('a', { parent: { parent: undefined } })],
        isSerial,
      ),
    { message: /^Playwright 1\.99\.0 .*Suite\._parallelMode/ },
  );
});

function listing({
  status,
  errors = [],
  tests = [],
}: {
  status?: FullResult['status'];
  errors?: string[];
  tests?: ReportedTest[];
}) {
  const result = status === undefined ? undefined : { status };
  const calls: string[][] = [];
  const playwright = {
    async listTests(
      reporter: LzPlaywrightCollectingReporter,
      params: { projects?: string[] },
    ) {
      calls.push(params.projects ?? []);
      errors.forEach((message) => reporter.onError({ message }));
      reporter.onBegin({ failOnFlakyTests: false }, { allTests: () => tests });

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
  const tests = ['create', 'edit'].map((id) =>
    fakeTestCase(id, { parent: serial }),
  );
  const { playwright, calls } = listing({ status: 'passed', tests });

  const groups = await listSerialGroups(playwright, ['chromium'], isSerial);

  assert.deepEqual(groups.get('edit'), ['create', 'edit']);
  assert.deepEqual(calls, [['chromium']]);
});

test('listing fails when a test file does not load, though the status says passed', async () => {
  const { playwright } = listing({
    status: 'passed',
    errors: ['SyntaxError in a.spec.ts', 'SyntaxError in b.spec.ts'],
  });

  await assert.rejects(listSerialGroups(playwright, [], isSerial), {
    message:
      'Playwright could not load every test file:\nSyntaxError in a.spec.ts\nSyntaxError in b.spec.ts',
  });
});

test('listing fails with the status Playwright reports', async () => {
  const { playwright } = listing({
    status: 'failed',
    errors: ['config error', 'second error'],
  });

  await assert.rejects(listSerialGroups(playwright, [], isSerial), {
    message:
      'Playwright could not list the tests (failed):\nconfig error\nsecond error',
  });
});

test('listing fails and points at the trace log when Playwright throws', async () => {
  const { playwright } = listing({});

  await assert.rejects(listSerialGroups(playwright, [], isSerial), {
    message: /--logLevel trace/,
  });
});
