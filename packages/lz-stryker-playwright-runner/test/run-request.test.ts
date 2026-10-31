import assert from 'node:assert/strict';
import { test } from 'node:test';

import { INSTRUMENTER_CONSTANTS } from '@stryker-mutator/api/core';

import { runSettingsEnv } from '../src/protocol.ts';
import {
  dryRunRequest,
  mutantRunRequest,
  runPlan,
} from '../src/run-request.ts';
import {
  dryRequest,
  dryRunOptions,
  mutantRequest,
  mutantRunOptions,
} from './support/doubles.ts';

const activeMutantEnv = INSTRUMENTER_CONSTANTS.ACTIVE_MUTANT_ENV_VARIABLE;

test('a mutant run request widens its filter to serial groups and gets its budget', () => {
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
    testFilter: ['create', 'edit'],
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
        testFilter: ['a', 'b'],
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
