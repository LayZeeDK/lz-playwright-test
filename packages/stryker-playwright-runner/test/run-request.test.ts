import assert from 'node:assert/strict';
import { test } from 'node:test';

import { INSTRUMENTER_CONSTANTS } from '@stryker-mutator/api/core';

import { runSettingsEnv } from '../src/protocol.ts';
import {
  dryRunRequest,
  mutantRunRequest,
  runPlan,
  serverMutantFor,
} from '../src/run-request.ts';
import {
  dryRequest,
  dryRunOptions,
  mutantRequest,
  mutantRunOptions,
  selected,
} from './support/doubles.ts';

const activeMutantEnv = INSTRUMENTER_CONSTANTS.ACTIVE_MUTANT_ENV_VARIABLE;

test('a mutant run request widens its filter to serial groups, keeps the covering tests, and gets its budget', () => {
  const request = mutantRunRequest(
    mutantRunOptions({
      testFilter: ['edit'],
      hitLimit: 50,
      disableBail: false,
      timeout: 8000,
    }),
    {
      serialGroups: new Map([['edit', ['create', 'edit']]]),
      timeouts: { testTimeoutCap: Infinity, expectTimeout: 1000 },
    },
  );

  assert.deepEqual(request, {
    kind: 'mutant',
    disableBail: false,
    activeMutant: '7',
    mutantActivation: 'static',
    selection: { covering: ['edit'], toRun: ['create', 'edit'] },
    hitLimit: 50,
    budget: { testTimeout: 2400, deadlineMs: 5400 },
  });
});

test('a dry run request keeps the config timeouts', () => {
  assert.deepEqual(dryRunRequest(dryRunOptions({ coverageAnalysis: 'all' })), {
    kind: 'dry',
    disableBail: false,
    coverageAnalysis: 'all',
    budget: { testTimeout: undefined, deadlineMs: undefined },
  });
});

test('a dry run plan runs every test with no active mutant, and collects per-test coverage only for perTest', () => {
  assert.deepEqual(runPlan(dryRequest(), 'out'), {
    env: {
      [runSettingsEnv]: '{"outDir":"out","perTest":true}',
      [activeMutantEnv]: undefined,
    },
    params: { testIds: undefined, maxFailures: undefined, timeout: undefined },
    control: {
      outDir: 'out',
      perTest: true,
      activeMutant: undefined,
      hitLimit: undefined,
    },
  });
  assert.equal(
    runPlan(dryRequest({ coverageAnalysis: 'all' }), 'out').env[runSettingsEnv],
    '{"outDir":"out","perTest":false}',
  );
});

test('a mutant run plan activates the mutant and runs its filter in its budget, with its hit limit', () => {
  assert.deepEqual(
    runPlan(
      mutantRequest({
        activeMutant: '7',
        selection: selected(['a', 'b']),
        hitLimit: 5,
        budget: { testTimeout: 900, deadlineMs: 1000 },
      }),
      'out',
    ),
    {
      env: {
        [runSettingsEnv]: '{"outDir":"out","perTest":false,"hitLimit":5}',
        [activeMutantEnv]: '7',
      },
      params: { testIds: ['a', 'b'], maxFailures: undefined, timeout: 900 },
      control: {
        outDir: 'out',
        perTest: false,
        activeMutant: '7',
        hitLimit: 5,
      },
    },
  );
});

test('a run plan names the webServer hosts for the test id header only when it collects per-test coverage', () => {
  const hosts = ['localhost:4820'];

  assert.equal(
    runPlan(dryRequest(), 'out', hosts).env[runSettingsEnv],
    '{"outDir":"out","perTest":true,"testIdHosts":["localhost:4820"]}',
  );
  assert.equal(
    runPlan(dryRequest({ coverageAnalysis: 'all' }), 'out', hosts).env[
      runSettingsEnv
    ],
    '{"outDir":"out","perTest":false}',
  );
  assert.equal(
    runPlan(mutantRequest(), 'out', hosts).env[runSettingsEnv],
    '{"outDir":"out","perTest":false}',
  );
});

test('a run plan issues the test ids to the webServer only when it collects per-test coverage', () => {
  const ids = ['a', 'b'];

  assert.deepEqual(
    runPlan(dryRequest(), 'out', [], ids).control.issuedTestIds,
    ids,
  );
  assert.ok(
    !(
      'issuedTestIds' in
      runPlan(dryRequest({ coverageAnalysis: 'all' }), 'out', [], ids).control
    ),
  );
  assert.ok(
    !('issuedTestIds' in runPlan(mutantRequest(), 'out', [], ids).control),
  );
});

test('a run plan names the webServer hosts to the webServer only when it collects per-test coverage', () => {
  const hosts = ['localhost:4820'];

  assert.deepEqual(
    runPlan(dryRequest(), 'out', hosts, []).control.testIdHosts,
    hosts,
  );
  assert.ok(
    !(
      'testIdHosts' in
      runPlan(dryRequest({ coverageAnalysis: 'all' }), 'out', hosts, []).control
    ),
  );
  assert.ok(
    !('testIdHosts' in runPlan(mutantRequest(), 'out', hosts, []).control),
  );
});

test('the webServer starts with the mutant of a statically activated mutant run, and with none otherwise', () => {
  assert.equal(
    serverMutantFor(
      mutantRequest({ activeMutant: '7', mutantActivation: 'static' }),
    ),
    '7',
  );
  assert.equal(
    serverMutantFor(
      mutantRequest({ activeMutant: '7', mutantActivation: 'runtime' }),
    ),
    undefined,
  );
  assert.equal(serverMutantFor(dryRequest()), undefined);
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
