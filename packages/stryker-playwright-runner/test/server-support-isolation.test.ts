import assert from 'node:assert/strict';
import { readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import {
  DryRunStatus,
  MutantRunStatus,
} from '@stryker-mutator/api/test-runner';

import {
  readServerMutantsFile,
  writeServerMutantsFile,
} from '../src/server-isolation.ts';
import { mutantRunBudget } from '../src/timeouts.ts';
import {
  dryRunOptions,
  mutantRunOptions,
  warnings,
  withoutPrototypes,
} from './support/doubles.ts';
import { fakePlaywright } from './support/fake-playwright.ts';
import {
  inSandbox,
  passAllWithDryRunServerMutants,
  runtimeRun,
  serverFake,
  webServer,
} from './support/server-fake.ts';

test('the dry run leaves the mutants the server ran in the sandbox, for the processes that did not run it', async (t) => {
  const fake = serverFake(t, {
    runTests: passAllWithDryRunServerMutants('2'),
  });
  const { shell } = fake.runner();
  await shell.init();

  await shell.dryRun(dryRunOptions());

  assert.deepEqual(readServerMutantsFile(fake.sandbox), {
    mutants: new Set(['2']),
  });
});

test('a process that did not run the dry run isolates by the server mutants the dry run left in the sandbox', async (t) => {
  const fake = serverFake(t);
  writeServerMutantsFile(fake.sandbox, ['2']);
  const { shell } = fake.runner();
  await shell.init();

  await shell.mutantRun(runtimeRun('1'));
  const setupsBeforeServerRun = fake.setups.length;
  await shell.mutantRun(runtimeRun('2'));

  assert.deepEqual([setupsBeforeServerRun, fake.setups.length], [1, 2]);
});

test('without the dry run server mutants in the sandbox, every mutant run isolates, after one warning', async (t) => {
  const fake = serverFake(t);
  const { shell, lines } = fake.runner();
  await shell.init();

  await shell.mutantRun(runtimeRun('1'));
  await shell.mutantRun(runtimeRun('3'));

  assert.equal(fake.setups.length, 3);
  assert.deepEqual(
    lines
      .filter(([level]) => level === 'warn')
      .map(([, message]) => [
        /\.lz-playwright-server-mutants/.test(message),
        message.endsWith(
          'so it restarts the webServer around every mutant run.',
        ),
      ]),
    [[true, true]],
  );
});

test('isolate false reads no server mutants: no warning and no restart without them', async (t) => {
  const fake = serverFake(t);
  const { shell, lines } = fake.runner({ isolate: false });
  await shell.init();

  await shell.mutantRun(runtimeRun('1'));
  await shell.mutantRun(runtimeRun('3'));

  assert.equal(fake.setups.length, 1);
  assert.deepEqual(
    lines.filter(([level]) => level === 'warn'),
    [],
  );
});

test('isolate false without the dry run server mutants in the sandbox restarts the webServer for every static mutant, after one warning', async (t) => {
  const fake = serverFake(t);
  const { shell, lines } = fake.runner({ isolate: false });
  await shell.init();
  const staticRun = (id: string) =>
    shell.mutantRun(
      mutantRunOptions({
        activeMutant: { ...mutantRunOptions().activeMutant, id },
        mutantActivation: 'static',
      }),
    );

  await staticRun('1');
  await staticRun('3');

  assert.deepEqual(
    fake.setups.map(({ activeMutant }) => activeMutant),
    [undefined, '1', '3'],
  );
  assert.deepEqual(
    warnings(lines).map((message) =>
      message.endsWith('so it restarts the webServer for every static mutant.'),
    ),
    [true],
  );
});

test('the process that ran the dry run isolates by what it kept, even when the sandbox file is gone', async (t) => {
  const fake = serverFake(t, {
    runTests: passAllWithDryRunServerMutants('2'),
  });
  const { shell, lines } = fake.runner();
  await shell.init();
  await shell.dryRun(dryRunOptions());
  rmSync(path.join(fake.sandbox, '.lz-playwright-server-mutants'));

  await shell.mutantRun(runtimeRun('1'));
  const setupsBeforeServerRun = fake.setups.length;
  await shell.mutantRun(runtimeRun('2'));

  assert.deepEqual([setupsBeforeServerRun, fake.setups.length], [2, 3]);
  assert.deepEqual(
    lines.filter(([level]) => level === 'warn'),
    [],
  );
});

test('isolate false also leaves the mutants the server ran in the sandbox, for the static mutant runs of the other processes', async (t) => {
  const fake = serverFake(t, {
    runTests: passAllWithDryRunServerMutants('2'),
  });
  const { shell } = fake.runner({ isolate: false });
  await shell.init();

  await shell.dryRun(dryRunOptions());

  assert.deepEqual(readServerMutantsFile(fake.sandbox), {
    mutants: new Set(['2']),
  });
});

test('isolate restarts the webServer once after the dry run tests when the dry run reached a server mutant', async (t) => {
  const fake = serverFake(t, { runTests: passAllWithDryRunServerMutants('2') });
  const { shell } = fake.runner();
  await shell.init();
  const callsBefore = fake.calls.length;

  await shell.dryRun(dryRunOptions());

  assert.deepEqual(
    fake
      .names()
      .slice(callsBefore)
      .filter((name) => name === 'runGlobalSetup' || name === 'runTests'),
    ['runTests', 'runGlobalSetup'],
  );
  assert.equal(fake.setups.at(-1)?.activeMutant, undefined);
});

/** Spins in real time: the runner reads performance.now(), which mock timers leave alone. */
function busyWait(ms: number): void {
  const until = performance.now() + ms;

  while (performance.now() < until) {
    // Spinning.
  }
}

test("the dry run's restart leaves the tests' times and coverage as Playwright and the snapshots gave them", async (t) => {
  const fake = serverFake(t, {
    runTests: passAllWithDryRunServerMutants('2'),
    hooked: () => {
      busyWait(fake.setups.length > 1 ? 100 : 0);

      return true;
    },
  });
  const { shell } = fake.runner();
  await shell.init();

  const result = await shell.dryRun(dryRunOptions());

  assert.equal(fake.setups.length, 2);
  assert.equal(result.status, DryRunStatus.Complete);
  assert.deepEqual(
    result.tests.map(({ id, timeSpentMs }) => ({ id, timeSpentMs })),
    [{ id: 'a', timeSpentMs: 7 }],
  );
  assert.deepEqual(withoutPrototypes(result.mutantCoverage), {
    static: {},
    perTest: { a: { '1': 1, '2': 1 } },
  });
});

test("the runner's deadline counts from the start of the mutant run, so a slow webServer restart leaves the tests less time", async (t) => {
  const timeout = 8_000;
  const restartMs = 600;
  const { deadlineMs } = mutantRunBudget(timeout, {
    testTimeoutCap: Infinity,
    expectTimeout: 5_000,
  });
  assert.ok(deadlineMs !== undefined);
  let stoppedInTime = false;
  const fake = serverFake(t, {
    hooked: () => {
      busyWait(fake.setups.length > 1 ? restartMs : 0);

      return true;
    },
    runTests: async () => {
      t.mock.timers.tick(deadlineMs - restartMs / 2);
      stoppedInTime = fake.names().includes('stopTests');
      t.mock.timers.tick(restartMs);
      await fake.stopped();

      return 'interrupted';
    },
  });
  const { shell } = fake.runner();
  await shell.init();
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });

  const result = await shell.mutantRun({ ...runtimeRun('1'), timeout });
  t.mock.timers.reset();

  assert.equal(fake.setups.length, 2);
  assert.equal(stoppedInTime, true);
  assert.equal(result.status, MutantRunStatus.Timeout);
});

test('isolate restarts the webServer before the first mutant run when the dry run saw that mutant on the server', async (t) => {
  const fake = serverFake(t, { runTests: passAllWithDryRunServerMutants('2') });
  const { shell } = fake.runner();
  await shell.init();
  await shell.dryRun(dryRunOptions());

  await shell.mutantRun(runtimeRun('2'));

  assert.deepEqual(
    fake.setups.map(({ activeMutant }) => activeMutant),
    [undefined, undefined, undefined],
  );
});

test("webServer.mutate: 'auto' with server coverage in the dry run isolates a server mutant run, like true", async (t) => {
  const fake = serverFake(t, { runTests: passAllWithDryRunServerMutants('2') });
  const { shell } = fake.runner({ mutate: 'auto' });
  await shell.init();
  await shell.dryRun(dryRunOptions());

  await shell.mutantRun(runtimeRun('2'));

  assert.equal(fake.setups.length, 3);
});

test("webServer.mutate: 'auto' whose dry run reached no server mutant turns server support off with one info line, so a static mutant run keeps the webServer", async (t) => {
  const fake = serverFake(t);
  const { shell, lines } = fake.runner({ mutate: 'auto' });
  await shell.init();
  await shell.dryRun(dryRunOptions());

  await shell.mutantRun(mutantRunOptions({ mutantActivation: 'static' }));

  assert.equal(fake.setups.length, 1);
  assert.deepEqual(
    lines.filter(([, message]) => message.includes("'auto'")),
    [
      [
        'info',
        "Server-side mutants stay NoCoverage: with lzPlaywright.webServer.mutate: 'auto', the dry run reached no mutant " +
          'in the code the Playwright webServer runs, so server support stays off.',
      ],
    ],
  );
});

test("with webServer.mutate: 'auto', the dry run process whose init turned server support off leaves that decision in the sandbox", async (t) => {
  const fake = serverFake(t, { hooked: false });
  const { shell } = fake.runner({ mutate: 'auto' });
  await shell.init();

  await shell.dryRun(dryRunOptions());

  assert.deepEqual(readServerMutantsFile(fake.sandbox), {
    mutants: new Set(),
  });
});

test("with webServer.mutate: 'auto' and isolate false, the dry run process leaves the server mutants it reached in the sandbox", async (t) => {
  const fake = serverFake(t, { runTests: passAllWithDryRunServerMutants('2') });
  const { shell } = fake.runner({ mutate: 'auto', isolate: false });
  await shell.init();

  await shell.dryRun(dryRunOptions());

  assert.deepEqual(readServerMutantsFile(fake.sandbox), {
    mutants: new Set(['2']),
  });
});

test("with webServer.mutate: 'auto', a process whose init turned server support off reports each mutant as an error, without a run, when the dry run turned it on", async (t) => {
  const fake = serverFake(t, { hooked: false });
  writeServerMutantsFile(fake.sandbox, ['2']);
  const { shell } = fake.runner({ mutate: 'auto' });
  await shell.init();

  const result = await shell.mutantRun(runtimeRun('1'));

  assert.deepEqual(result, {
    status: MutantRunStatus.Error,
    errorMessage:
      "lzPlaywright.webServer.mutate is 'auto' and the dry run reached server-side mutants, but this process turned " +
      'server support off at init (see its warning), so it cannot run them. Set lzPlaywright.webServer.mutate: true ' +
      'to see the cause as an error.',
  });
  assert.equal(fake.runs.length, 0);
});

test("with webServer.mutate: 'auto', a process whose init turned server support off runs mutants when the dry run reached no server mutant", async (t) => {
  const fake = serverFake(t, { hooked: false });
  writeServerMutantsFile(fake.sandbox, []);
  const { shell } = fake.runner({ mutate: 'auto' });
  await shell.init();

  await shell.mutantRun(runtimeRun('1'));

  assert.equal(fake.runs.length, 1);
});

test("with webServer.mutate: 'auto', the dry run process follows what its own dry run reached, not a later sandbox file", async (t) => {
  const fake = serverFake(t, { runTests: passAllWithDryRunServerMutants('2') });
  const { shell } = fake.runner({ mutate: 'auto' });
  await shell.init();
  await shell.dryRun(dryRunOptions());
  writeServerMutantsFile(fake.sandbox, []);

  await shell.mutantRun(runtimeRun('2'));

  assert.equal(fake.setups.length, 3);
});

test("with webServer.mutate: 'auto', a process that did not run the dry run follows its on decision and isolates by its server mutants", async (t) => {
  const fake = serverFake(t);
  writeServerMutantsFile(fake.sandbox, ['2']);
  const { shell } = fake.runner({ mutate: 'auto' });
  await shell.init();

  await shell.mutantRun(runtimeRun('1'));
  const setupsBeforeServerRun = fake.setups.length;
  await shell.mutantRun(runtimeRun('2'));

  assert.deepEqual([setupsBeforeServerRun, fake.setups.length], [1, 2]);
});

test("with webServer.mutate: 'auto', a process that finds no decision in the sandbox keeps server support and isolates every run, after one warning", async (t) => {
  const fake = serverFake(t);
  const { shell, lines } = fake.runner({ mutate: 'auto' });
  await shell.init();

  await shell.mutantRun(runtimeRun('1'));
  await shell.mutantRun(runtimeRun('3'));

  assert.equal(fake.setups.length, 3);
  assert.deepEqual(
    warnings(lines).map((message) =>
      message.includes('.lz-playwright-server-mutants'),
    ),
    [true],
  );
});

test("with webServer.mutate: 'auto', a process that did not run the dry run follows its off decision, even with isolate false", async (t) => {
  const fake = serverFake(t);
  writeServerMutantsFile(fake.sandbox, []);
  const { shell } = fake.runner({ mutate: 'auto', isolate: false });
  await shell.init();

  await shell.mutantRun(mutantRunOptions({ mutantActivation: 'static' }));

  assert.equal(fake.setups.length, 1);
});

test("with webServer.mutate: 'auto', a process that follows the dry run's off decision tells the webServer no active mutant", async (t) => {
  const fake = serverFake(t);
  writeServerMutantsFile(fake.sandbox, []);
  const { shell } = fake.runner({ mutate: 'auto' });
  await shell.init();

  await shell.mutantRun(runtimeRun('1'));

  assert.deepEqual(fake.controls, [undefined]);
});

test('isolate keeps the webServer between runs the server did not run in the dry run', async (t) => {
  const fake = serverFake(t, { runTests: passAllWithDryRunServerMutants('2') });
  const { shell } = fake.runner();
  await shell.init();
  await shell.dryRun(dryRunOptions());

  await shell.mutantRun(runtimeRun('1'));
  await shell.mutantRun(runtimeRun('3'));

  assert.equal(fake.setups.length, 2);
});

test('isolate restarts the webServer after a server run, and around each of two server runs in a row', async (t) => {
  const fake = serverFake(t, {
    runTests: passAllWithDryRunServerMutants('2', '4'),
  });
  const { shell } = fake.runner();
  await shell.init();
  await shell.dryRun(dryRunOptions());
  const restartsBefore: number[] = [];
  const run = async (id: string) => {
    const before = fake.setups.length;
    await shell.mutantRun(runtimeRun(id));
    restartsBefore.push(fake.setups.length - before);
  };

  await run('1');
  await run('2');
  await run('4');
  await run('1');
  await run('3');

  assert.deepEqual(restartsBefore, [0, 1, 1, 1, 0]);
});

test('isolate false never restarts the webServer around server runs', async (t) => {
  const fake = serverFake(t, { runTests: passAllWithDryRunServerMutants('2') });
  const { shell } = fake.runner({ isolate: false });
  await shell.init();
  await shell.dryRun(dryRunOptions());

  await shell.mutantRun(runtimeRun('2'));
  await shell.mutantRun(runtimeRun('1'));

  assert.equal(fake.setups.length, 1);
});

for (const isolate of [true, false]) {
  test(`a static server mutant restarts the webServer once, with that mutant (isolate ${isolate})`, async (t) => {
    const fake = serverFake(t, {
      runTests: passAllWithDryRunServerMutants('2'),
    });
    const { shell } = fake.runner({ isolate });
    await shell.init();
    await shell.dryRun(dryRunOptions());

    await shell.mutantRun(
      mutantRunOptions({
        activeMutant: { ...mutantRunOptions().activeMutant, id: '2' },
        mutantActivation: 'static',
      }),
    );

    assert.deepEqual(
      fake.setups.map(({ activeMutant }) => activeMutant),
      isolate ? [undefined, undefined, '2'] : [undefined, '2'],
    );
  });
}

test('webServer.mutate: false never restarts the webServer to isolate a run', async (t) => {
  const fake = fakePlaywright(t, {
    webServers: [webServer],
    runTests: passAllWithDryRunServerMutants('2'),
  });
  const { shell } = fake.runner({
    lzPlaywright: { webServer: { mutate: false } },
  });
  await shell.init();
  await shell.dryRun(dryRunOptions());

  await shell.mutantRun(runtimeRun('2'));
  await shell.mutantRun(runtimeRun('1'));

  assert.equal(
    fake.names().filter((name) => name === 'runGlobalSetup').length,
    1,
  );
});

test('webServer.mutate: false reads no server mutants, so it warns about none', async (t) => {
  inSandbox(t);
  const fake = fakePlaywright(t, { webServers: [webServer] });
  const { shell, lines } = fake.runner({
    lzPlaywright: { webServer: { mutate: false } },
  });
  await shell.init();

  await shell.mutantRun(runtimeRun('2'));

  assert.deepEqual(
    lines.filter(([level]) => level === 'warn'),
    [],
  );
});

test('webServer.mutate: false leaves no server mutants in the sandbox', async (t) => {
  const sandbox = inSandbox(t);
  const fake = fakePlaywright(t, {
    webServers: [webServer],
    runTests: passAllWithDryRunServerMutants('2'),
  });
  const { shell } = fake.runner({
    lzPlaywright: { webServer: { mutate: false } },
  });
  await shell.init();

  await shell.dryRun(dryRunOptions());

  assert.deepEqual(readdirSync(sandbox), []);
});
