// Server support in the runner's shell, against the fake Playwright install in support/fake-playwright.ts.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import {
  DryRunStatus,
  MutantRunStatus,
} from '@stryker-mutator/api/test-runner';

import { serializeSnapshot } from '../src/protocol.ts';
import { serverDirEnv } from '../src/server-protocol.ts';
import {
  dryRunOptions,
  fakeTestCase,
  finishedTest,
  mutantRunOptions,
  warnings,
  withoutPrototypes,
} from './support/doubles.ts';
import {
  activeMutantEnv,
  fakePlaywright,
  passAll,
  stubEnv,
} from './support/fake-playwright.ts';
import {
  passAllWithDryRunServerMutants,
  runtimeRun,
  serverFake,
  serverHookUrl,
  webServer,
} from './support/server-fake.ts';

test('without webServer.mutate, global setup gets neither the server hook nor its folder', async (t) => {
  const setups: (string | undefined)[] = [];
  const fake = fakePlaywright(t, {
    webServers: [webServer],
    globalSetup: () => {
      setups.push(process.env[serverDirEnv]);

      return 'passed';
    },
  });
  const { shell } = fake.runner();

  await shell.init();
  await shell.dryRun(dryRunOptions());

  assert.deepEqual(setups, [undefined]);
  assert.equal(fake.runs[0]?.settings.testIdHosts, undefined);
});

test('webServer.mutate: true gives global setup the server folder and tags the dry run requests to the webServer', async (t) => {
  const fake = serverFake(t);
  const { shell } = fake.runner();

  await shell.init();
  await shell.dryRun(dryRunOptions());

  assert.equal(path.basename(fake.setups[0]?.serverDir ?? ''), 'server');
  assert.deepEqual(fake.runs[0]?.settings.testIdHosts, ['localhost:4820']);
});

const hint =
  'Server-side mutants stay NoCoverage: the code the Playwright webServer runs is mutated only with lzPlaywright.webServer.mutate: true.';

test('without webServer.mutate, the dry run of a config with a webServer logs one hint to turn it on', async (t) => {
  const fake = fakePlaywright(t, { webServers: [webServer] });
  const { shell, lines } = fake.runner();
  await shell.init();

  await shell.dryRun(dryRunOptions());

  assert.deepEqual(
    lines.filter(([, message]) => message.includes('webServer.mutate')),
    [['info', hint]],
  );
});

test('with webServer.mutate: true, the dry run gives no hint', async (t) => {
  const fake = serverFake(t);
  const { shell, lines } = fake.runner();
  await shell.init();

  await shell.dryRun(dryRunOptions());

  assert.deepEqual(
    lines.filter(([, message]) => message === hint),
    [],
  );
});

test("webServer.mutate: 'auto' gives global setup the server hook and tags the dry run requests, like true", async (t) => {
  const fake = serverFake(t);
  const { shell } = fake.runner({ mutate: 'auto' });

  await shell.init();
  await shell.dryRun(dryRunOptions());

  assert.equal(
    fake.setups[0]?.nodeOptions,
    `--import "${serverHookUrl}" --no-warnings`,
  );
  assert.deepEqual(fake.runs[0]?.settings.testIdHosts, ['localhost:4820']);
});

test('global setup starts the webServer with the server hook before the base NODE_OPTIONS, and no mutant', async (t) => {
  const fake = serverFake(t);
  const { shell } = fake.runner();

  await shell.init();

  const [setup, ...more] = fake.setups;
  assert.ok(setup && more.length === 0);
  assert.equal(setup.nodeOptions, `--import "${serverHookUrl}" --no-warnings`);
  assert.equal(path.basename(setup.serverDir ?? ''), 'server');
  assert.equal(setup.activeMutant, undefined);
  assert.equal(process.env[serverDirEnv], undefined, 'restored after setup');
});

test('without base NODE_OPTIONS, global setup starts the webServer with only the server hook', async (t) => {
  const fake = serverFake(t);
  stubEnv(t, { NODE_OPTIONS: undefined });
  const { shell } = fake.runner();

  await shell.init();

  assert.deepEqual(
    fake.setups.map((setup) => setup.nodeOptions),
    [`--import "${serverHookUrl}"`],
  );
});

test('each run writes the control file before its tests run, and a per-test dry run names the webServer hosts and issues the listed test ids', async (t) => {
  const fake = serverFake(t, {
    listed: [fakeTestCase('a'), fakeTestCase('b')],
  });
  const { shell } = fake.runner();
  await shell.init();

  await shell.dryRun(dryRunOptions());
  await shell.mutantRun(
    mutantRunOptions({
      mutantActivation: 'runtime',
      testFilter: ['a'],
      hitLimit: 9,
    }),
  );

  const [dry, mutant] = fake.runs;
  assert.ok(dry && mutant);
  assert.deepEqual(fake.controls, [
    {
      outDir: dry.settings.outDir,
      perTest: true,
      activeMutant: undefined,
      hitLimit: undefined,
      issuedTestIds: ['a', 'b'],
      testIdHosts: ['localhost:4820'],
    },
    {
      outDir: mutant.settings.outDir,
      perTest: false,
      activeMutant: '7',
      hitLimit: 9,
    },
  ]);
  assert.deepEqual(dry.settings.testIdHosts, ['localhost:4820']);
  assert.equal(mutant.settings.testIdHosts, undefined);
});

test('a static mutant run restarts the webServer with that mutant, and the next runtime run restarts it without', async (t) => {
  const fake = serverFake(t);
  const { shell } = fake.runner({ isolate: false });
  await shell.init();
  const run = (id: string, mutantActivation: 'static' | 'runtime') =>
    shell.mutantRun(
      mutantRunOptions({
        activeMutant: { ...mutantRunOptions().activeMutant, id },
        mutantActivation,
        ...(mutantActivation === 'runtime' ? { testFilter: ['a'] } : {}),
      }),
    );

  await run('1', 'runtime');
  await run('2', 'static');
  await run('3', 'static');
  await run('3', 'static');
  await run('4', 'runtime');
  await run('5', 'runtime');

  assert.deepEqual(
    fake.setups.map(({ activeMutant }) => activeMutant),
    [undefined, '2', '3', undefined],
  );
  assert.equal(
    fake.names().filter((name) => name === 'runGlobalSetup').length,
    4,
  );
});

for (const isolate of [false, true]) {
  test(`a static mutant that the webServer did not reach in the dry run keeps the webServer (isolate ${isolate})`, async (t) => {
    const fake = serverFake(t, {
      runTests: passAllWithDryRunServerMutants('2'),
    });
    const { shell } = fake.runner({ isolate });
    await shell.init();
    await shell.dryRun(dryRunOptions());
    const setupsBefore = fake.setups.length;

    await shell.mutantRun(
      mutantRunOptions({
        activeMutant: { ...mutantRunOptions().activeMutant, id: '3' },
        mutantActivation: 'static',
      }),
    );

    assert.equal(fake.setups.length, setupsBefore);
  });
}

test('a static mutant the webServer did not reach restarts it without the static mutant it ran before', async (t) => {
  const fake = serverFake(t, { runTests: passAllWithDryRunServerMutants('2') });
  const { shell } = fake.runner({ isolate: false });
  await shell.init();
  await shell.dryRun(dryRunOptions());
  const staticRun = (id: string) =>
    shell.mutantRun(
      mutantRunOptions({
        activeMutant: { ...mutantRunOptions().activeMutant, id },
        mutantActivation: 'static',
      }),
    );

  await staticRun('2');
  await staticRun('3');

  assert.deepEqual(
    fake.setups.map(({ activeMutant }) => activeMutant),
    [undefined, '2', undefined],
  );
});

test('each webServer restart logs one debug line that names the static mutant it starts with, or none', async (t) => {
  const fake = serverFake(t, { runTests: passAllWithDryRunServerMutants('2') });
  const { shell, lines } = fake.runner({ isolate: false });
  await shell.init();
  await shell.dryRun(dryRunOptions());
  const staticRun = (id: string) =>
    shell.mutantRun(
      mutantRunOptions({
        activeMutant: { ...mutantRunOptions().activeMutant, id },
        mutantActivation: 'static',
      }),
    );

  await staticRun('2');
  await staticRun('3');

  assert.deepEqual(
    lines.filter(([, message]) => message.startsWith('Restarting')),
    [
      ['debug', 'Restarting the webServer with static mutant 2.'],
      ['debug', 'Restarting the webServer without a mutant.'],
    ],
  );
});

test('a webServer restarted after it died keeps the static mutant it runs', async (t) => {
  let up = true;
  const fake = serverFake(t, {
    webServers: [{ url: 'http://localhost:4820/' }],
    globalTeardown: async () => {
      up = false;
    },
    urlUp: async () => {
      const answered = up;
      up = true;

      return answered;
    },
  });
  const { shell } = fake.runner({ isolate: false });
  await shell.init();
  await shell.mutantRun(mutantRunOptions({ mutantActivation: 'static' }));
  up = false;
  await shell.mutantRun(mutantRunOptions({ mutantActivation: 'static' }));

  assert.deepEqual(
    fake.setups.map(({ activeMutant }) => activeMutant),
    [undefined, '7', '7'],
  );
});

function lingeringWebServer(lingeringProbes: number) {
  let up = false;
  let lingering = 0;

  return {
    hooked: () => !up && lingering === 0,
    globalSetup: () => {
      up = true;

      return 'passed' as const;
    },
    globalTeardown: async () => {
      lingering = up ? lingeringProbes : 0;
      up = false;
    },
    urlUp: async () => {
      if (lingering > 0) {
        lingering -= 1;

        return true;
      }

      return up;
    },
  };
}

test('a webServer restart waits after global teardown until the stopped server no longer answers, then runs global setup', async (t) => {
  const fake = serverFake(t, lingeringWebServer(3));
  const { shell } = fake.runner({ isolate: false });
  await shell.init();
  fake.calls.length = 0;

  const result = await shell.mutantRun(
    mutantRunOptions({ mutantActivation: 'static' }),
  );

  assert.equal(result.status, MutantRunStatus.Survived);
  assert.deepEqual(fake.names(), [
    'runGlobalTeardown',
    'isURLAvailable',
    'isURLAvailable',
    'isURLAvailable',
    'isURLAvailable',
    'runGlobalSetup',
    'isURLAvailable',
    'runTests',
  ]);
});

test('a webServer restart whose stopped server keeps answering stops waiting after 2 s and rejects with the hook refusal', async (t) => {
  const stoppedWaitMs = 2000;
  const hookedWaitMs = 1000;
  const fake = serverFake(t, lingeringWebServer(200));
  const { shell } = fake.runner({ isolate: false });
  await shell.init();
  const startedAt = performance.now();

  await assert.rejects(
    shell.mutantRun(mutantRunOptions({ mutantActivation: 'static' })),
    {
      message:
        /^lzPlaywright\.webServer\.mutate is true, but no process that Playwright global setup started loaded the server hook\./,
    },
  );
  assert.ok(performance.now() - startedAt < stoppedWaitMs + hookedWaitMs + 500);
});

test('a static mutant whose dead webServer starts again only without the mutant is killed', async (t) => {
  let up = true;
  let failsWithMutant = false;
  const fake = serverFake(t, {
    webServers: [{ url: 'http://localhost:4820/' }],
    globalSetup: () =>
      failsWithMutant && process.env[activeMutantEnv] !== undefined
        ? 'failed'
        : 'passed',
    globalTeardown: async () => {
      up = false;
    },
    urlUp: async () => {
      const answered = up;
      up = true;

      return answered;
    },
  });
  const { shell } = fake.runner({ isolate: false });
  await shell.init();
  await shell.mutantRun(mutantRunOptions({ mutantActivation: 'static' }));
  up = false;
  failsWithMutant = true;

  const result = await shell.mutantRun(
    mutantRunOptions({ mutantActivation: 'static' }),
  );

  assert.equal(result.status, MutantRunStatus.Killed);
});

test('a static mutant that keeps the webServer from starting is killed, with the mutant and the second setup error as its message', async (t) => {
  let startsWithMutant = 0;
  const fake = serverFake(t, {
    globalSetup: (reporter) => {
      if (process.env[activeMutantEnv] === undefined) {
        return 'passed';
      }

      startsWithMutant += 1;
      reporter.onError?.({
        message: `listen EADDRINUSE (start ${startsWithMutant})`,
      });

      return 'failed';
    },
  });
  const { shell } = fake.runner({ isolate: false });
  await shell.init();

  const result = await shell.mutantRun(
    mutantRunOptions({ mutantActivation: 'static' }),
  );

  assert.deepEqual(result, {
    status: MutantRunStatus.Killed,
    killedBy: [],
    failureMessage:
      'The webServer did not start with static mutant 7: Error: Playwright global setup failed:\nlisten EADDRINUSE (start 2)\n',
    nrOfTests: 0,
  });
});

test('a static mutant whose webServer fails to start once with it, but starts with it again after a start without it, runs its tests', async (t) => {
  let failures = 1;
  const fake = serverFake(t, {
    globalSetup: () => {
      if (process.env[activeMutantEnv] === undefined || failures === 0) {
        return 'passed';
      }

      failures -= 1;

      return 'failed';
    },
  });
  const { shell } = fake.runner({ isolate: false });
  await shell.init();

  const result = await shell.mutantRun(
    mutantRunOptions({ mutantActivation: 'static' }),
  );

  assert.equal(result.status, MutantRunStatus.Survived);
  assert.deepEqual(
    fake.setups.map(({ activeMutant }) => activeMutant),
    [undefined, '7', undefined, '7'],
  );
});

test('a static mutant run whose webServer, started without the mutant after it failed with it, loads no server hook rejects with that refusal', async (t) => {
  let hookLoads = true;
  const fake = serverFake(t, {
    hooked: () => hookLoads,
    globalSetup: () =>
      process.env[activeMutantEnv] === undefined ? 'passed' : 'failed',
  });
  const { shell } = fake.runner({ isolate: false });
  await shell.init();
  hookLoads = false;

  await assert.rejects(
    shell.mutantRun(mutantRunOptions({ mutantActivation: 'static' })),
    {
      message:
        /^lzPlaywright\.webServer\.mutate is true, but no process that Playwright global setup started loaded the server hook\./,
    },
  );
});

test('a static mutant run whose webServer, started with the mutant again after a start without it, loads no server hook rejects with that refusal', async (t) => {
  let failures = 1;
  const fake = serverFake(t, {
    hooked: () => process.env[activeMutantEnv] === undefined,
    globalSetup: () => {
      if (process.env[activeMutantEnv] === undefined || failures === 0) {
        return 'passed';
      }

      failures -= 1;

      return 'failed';
    },
  });
  const { shell } = fake.runner({ isolate: false });
  await shell.init();

  await assert.rejects(
    shell.mutantRun(mutantRunOptions({ mutantActivation: 'static' })),
    {
      message:
        /^lzPlaywright\.webServer\.mutate is true, but no process that Playwright global setup started loaded the server hook\./,
    },
  );
});

test('a static mutant run whose webServer starts neither with the mutant nor without it rejects with the setup error, so Stryker retries it', async (t) => {
  let broken = false;
  const fake = serverFake(t, {
    globalSetup: (reporter) => {
      if (!broken) {
        return 'passed';
      }

      reporter.onError?.({
        message: `seed database unreachable (mutant ${process.env[activeMutantEnv]})`,
      });

      return 'failed';
    },
  });
  const { shell } = fake.runner({ isolate: false });
  await shell.init();
  broken = true;

  await assert.rejects(
    shell.mutantRun(mutantRunOptions({ mutantActivation: 'static' })),
    {
      message:
        'Playwright global setup failed:\nseed database unreachable (mutant 7)\n',
    },
  );
});

test('a static mutant run whose webServer fails its last start without the mutant rejects with that error, so Stryker retries it', async (t) => {
  let startsWithout = 0;
  const fake = serverFake(t, {
    globalSetup: (reporter) => {
      if (process.env[activeMutantEnv] !== undefined) {
        return 'failed';
      }

      startsWithout += 1;

      if (startsWithout < 3) {
        return 'passed';
      }

      reporter.onError?.({ message: 'seed database unreachable' });

      return 'failed';
    },
  });
  const { shell } = fake.runner({ isolate: false });
  await shell.init();

  await assert.rejects(
    shell.mutantRun(mutantRunOptions({ mutantActivation: 'static' })),
    { message: 'Playwright global setup failed:\nseed database unreachable\n' },
  );
  assert.deepEqual(
    fake.setups.map(({ activeMutant }) => activeMutant),
    [undefined, '7', undefined, '7', undefined],
  );
});

test('a static mutant whose webServer did not start with it twice is killed and leaves the webServer started without it, so the next run needs no restart', async (t) => {
  let up = true;
  const fake = serverFake(t, {
    globalSetup: () => {
      up = process.env[activeMutantEnv] === undefined;

      return up ? 'passed' : 'failed';
    },
    globalTeardown: async () => {
      up = false;
    },
    urlUp: async () => up,
  });
  const { shell, lines } = fake.runner({ isolate: false });
  await shell.init();
  const setupMutants = () =>
    fake.setups.map(({ activeMutant }) => activeMutant);

  const killed = await shell.mutantRun(
    mutantRunOptions({ mutantActivation: 'static' }),
  );

  assert.equal(killed.status, MutantRunStatus.Killed);
  assert.deepEqual(setupMutants(), [undefined, '7', undefined, '7', undefined]);

  await shell.mutantRun(runtimeRun('8'));

  assert.deepEqual(setupMutants(), [undefined, '7', undefined, '7', undefined]);
  assert.deepEqual(
    warnings(lines).filter((warning) => warning.includes('stopped answering')),
    [],
  );
  assert.equal(fake.runs.length, 1);
});

test("the dry run merges the server's snapshots with the workers'", async (t) => {
  const fake = serverFake(t, {
    runTests: async (run) => {
      await passAll(run);
      run.reporter.onTestEnd(finishedTest('b', 'passed'));
      writeFileSync(
        path.join(run.settings.outDir, 'server-9-x.ndjson'),
        serializeSnapshot({
          mutantCoverage: { static: { '3': 1 }, perTest: { b: { '2': 1 } } },
          outlivedItsTest: false,
        }) + '\n',
      );

      return 'passed';
    },
  });
  const { shell } = fake.runner();
  await shell.init();

  const result = await shell.dryRun(dryRunOptions());

  assert.equal(result.status, DryRunStatus.Complete);
  assert.deepEqual(withoutPrototypes(result.mutantCoverage), {
    static: { '3': 1 },
    perTest: { a: { '1': 1 }, b: { '2': 1 } },
  });
});
