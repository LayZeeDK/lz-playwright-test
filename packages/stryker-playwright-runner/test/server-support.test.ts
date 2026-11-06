// Server support in the runner's shell, against the fake Playwright install in support/fake-playwright.ts.
import assert from 'node:assert/strict';
import { readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { type TestContext, test } from 'node:test';
import { setImmediate, setTimeout } from 'node:timers/promises';

import { DryRunStatus } from '@stryker-mutator/api/test-runner';

import { serializeSnapshot } from '../src/protocol.ts';
import {
  readServerMutantsFile,
  writeServerMutantsFile,
} from '../src/server-isolation.ts';
import {
  hookedPrefix,
  readServerControl,
  type ServerControl,
  serverDirEnv,
} from '../src/server-protocol.ts';
import {
  dryRunOptions,
  fakeTestCase,
  finishedTest,
  mutantRunOptions,
  tempTree,
  withoutPrototypes,
} from './support/doubles.ts';
import {
  activeMutantEnv,
  type Behaviour,
  fakePlaywright,
  passAll,
  type Run,
  type Status,
  stubEnv,
} from './support/fake-playwright.ts';

const serverHookUrl = new URL('../src/server-hook.ts', import.meta.url).href;
// A url, not a port: the fake answers the url check, and a port check would connect for real.
const webServer = { url: 'http://127.0.0.1:4820/' };

interface Setup {
  readonly nodeOptions: string | undefined;
  readonly serverDir: string | undefined;
  readonly activeMutant: string | undefined;
}

/** Stryker starts each test runner process in its sandbox folder. */
function inSandbox(t: TestContext): string {
  const cwd = process.cwd();
  t.after(() => process.chdir(cwd));
  const sandbox = tempTree(t, 'sandbox-');
  process.chdir(sandbox);

  return sandbox;
}

function serverFake(
  t: TestContext,
  {
    hooked = true,
    ...behaviour
  }: Behaviour & { readonly hooked?: boolean | (() => boolean) } = {},
) {
  stubEnv(t, { NODE_OPTIONS: '--no-warnings' });
  const sandbox = inSandbox(t);
  const setups: Setup[] = [];
  const controls: (ServerControl | undefined)[] = [];
  const fake = fakePlaywright(t, {
    ...behaviour,
    webServers: behaviour.webServers ?? [webServer],
    globalSetup: () => {
      const serverDir = process.env[serverDirEnv];
      setups.push({
        nodeOptions: process.env['NODE_OPTIONS'],
        serverDir,
        activeMutant: process.env[activeMutantEnv],
      });

      if (
        (typeof hooked === 'function' ? hooked() : hooked) &&
        serverDir !== undefined
      ) {
        writeFileSync(path.join(serverDir, `${hookedPrefix}1`), '');
      }

      return 'passed';
    },
    runTests: async (run: Run) => {
      const serverDir = setups.at(-1)?.serverDir;
      controls.push(
        serverDir === undefined ? undefined : readServerControl(serverDir),
      );

      return (behaviour.runTests ?? passAll)(run);
    },
  });

  return {
    ...fake,
    runner: ({
      isolate,
      mutate = true,
      ...strykerOptions
    }: {
      readonly isolate?: boolean;
      readonly mutate?: true | 'auto';
      readonly timeoutMS?: number;
      readonly concurrency?: number;
      readonly checkers?: readonly string[];
    } = {}) =>
      fake.runner({
        ...strykerOptions,
        lzPlaywright: {
          webServer: {
            mutate,
            ...(isolate === undefined ? {} : { isolate }),
          },
        },
      }),
    setups,
    controls,
    sandbox,
  };
}

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

test('a webServer restarted after it died keeps the static mutant it runs', async (t) => {
  let up = true;
  const fake = serverFake(t, {
    webServers: [{ url: 'http://localhost:4820/' }],
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

function runtimeRun(id: string) {
  return mutantRunOptions({
    activeMutant: { ...mutantRunOptions().activeMutant, id },
    mutantActivation: 'runtime',
    testFilter: ['a'],
  });
}

function passAllWithDryRunServerMutants(...ids: readonly string[]) {
  return async (run: Run) => {
    await passAll(run);

    if (run.settings.perTest) {
      writeFileSync(
        path.join(run.settings.outDir, 'server-9-x.ndjson'),
        serializeSnapshot({
          mutantCoverage: {
            static: {},
            perTest: { a: Object.fromEntries(ids.map((id) => [id, 1])) },
          },
          outlivedItsTest: false,
        }) + '\n',
      );
    }

    return 'passed' as const;
  };
}

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
      .map(([, message]) => /\.lz-playwright-server-mutants/.test(message)),
    [true],
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

  assert.deepEqual([setupsBeforeServerRun, fake.setups.length], [1, 2]);
  assert.deepEqual(
    lines.filter(([level]) => level === 'warn'),
    [],
  );
});

test('isolate false leaves no server mutants in the sandbox', async (t) => {
  const fake = serverFake(t, {
    runTests: passAllWithDryRunServerMutants('2'),
  });
  const { shell } = fake.runner({ isolate: false });
  await shell.init();

  await shell.dryRun(dryRunOptions());

  assert.deepEqual(readdirSync(fake.sandbox), []);
});

test('isolate restarts the webServer before the first mutant run when the dry run saw that mutant on the server', async (t) => {
  const fake = serverFake(t, { runTests: passAllWithDryRunServerMutants('2') });
  const { shell } = fake.runner();
  await shell.init();
  await shell.dryRun(dryRunOptions());

  await shell.mutantRun(runtimeRun('2'));

  assert.deepEqual(
    fake.setups.map(({ activeMutant }) => activeMutant),
    [undefined, undefined],
  );
});

test("webServer.mutate: 'auto' with server coverage in the dry run isolates a server mutant run, like true", async (t) => {
  const fake = serverFake(t, { runTests: passAllWithDryRunServerMutants('2') });
  const { shell } = fake.runner({ mutate: 'auto' });
  await shell.init();
  await shell.dryRun(dryRunOptions());

  await shell.mutantRun(runtimeRun('2'));

  assert.equal(fake.setups.length, 2);
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

test("with webServer.mutate: 'auto', a process whose init turned server support off refuses to run mutants when the dry run turned it on", async (t) => {
  const fake = serverFake(t, { hooked: false });
  writeServerMutantsFile(fake.sandbox, ['2']);
  const { shell } = fake.runner({ mutate: 'auto' });
  await shell.init();

  await assert.rejects(shell.mutantRun(runtimeRun('1')), {
    message:
      "lzPlaywright.webServer.mutate is 'auto' and the dry run reached server-side mutants, but this process turned " +
      'server support off at init (see its warning), so it cannot run them. Set lzPlaywright.webServer.mutate: true ' +
      'to see the cause as an error.',
  });
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

  assert.equal(fake.setups.length, 2);
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

test('isolate keeps the webServer between runs the server did not run in the dry run', async (t) => {
  const fake = serverFake(t, { runTests: passAllWithDryRunServerMutants('2') });
  const { shell } = fake.runner();
  await shell.init();
  await shell.dryRun(dryRunOptions());

  await shell.mutantRun(runtimeRun('1'));
  await shell.mutantRun(runtimeRun('3'));

  assert.equal(fake.setups.length, 1);
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
      [undefined, '2'],
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

test('init refuses a webServer whose env sets NODE_OPTIONS', async (t) => {
  const fake = serverFake(t, {
    webServers: [{ ...webServer, env: { NODE_OPTIONS: '--inspect' } }],
  });
  const { shell } = fake.runner();

  await assert.rejects(shell.init(), {
    message: `lzPlaywright.webServer.mutate is true, but a webServer's env sets NODE_OPTIONS, which replaces the one that loads the server hook. Set NODE_OPTIONS in the environment that runs Stryker instead.`,
  });
  assert.deepEqual(fake.setups, []);
});

test("with webServer.mutate: 'auto', init turns server support off with one warning when a webServer's env sets NODE_OPTIONS", async (t) => {
  const fake = serverFake(t, {
    webServers: [{ ...webServer, env: { NODE_OPTIONS: '--inspect' } }],
  });
  const { shell, lines } = fake.runner({ mutate: 'auto' });

  await shell.init();

  assert.deepEqual(warnings(lines), [
    "lzPlaywright.webServer.mutate is 'auto', but a webServer's env sets NODE_OPTIONS, which replaces the one that " +
      'loads the server hook. Set NODE_OPTIONS in the environment that runs Stryker instead.' +
      autoOff,
  ]);
  assert.deepEqual(
    fake.setups.map(({ serverDir }) => serverDir),
    [undefined],
  );
});

test('init refuses a reuseExistingServer server that already answers, and starts one that does not', async (t) => {
  const shared = serverFake(t, {
    webServers: [{ url: 'http://localhost:4820/', reuseExistingServer: true }],
  });

  await assert.rejects(shared.runner().shell.init(), (error) => {
    assert.ok(error instanceof Error);
    assert.equal(
      error.message,
      'lzPlaywright.webServer.mutate is true, but the webServer at http://localhost:4820/ already answers and ' +
        'reuseExistingServer is true. Only the Stryker process that started a server can switch its mutant: ' +
        'stop the server that answers there, or give the webServer a port that no other server uses.',
    );

    return true;
  });
  assert.deepEqual(shared.setups, []);
});

test("with webServer.mutate: 'auto', init turns server support off with one warning when a reuseExistingServer server already answers", async (t) => {
  const fake = serverFake(t, {
    webServers: [{ url: 'http://localhost:4820/', reuseExistingServer: true }],
  });
  const { shell, lines } = fake.runner({ mutate: 'auto' });

  await shell.init();

  const [warning, ...more] = warnings(lines);
  assert.equal(more.length, 0);
  assert.match(
    warning ?? '',
    /^lzPlaywright\.webServer\.mutate is 'auto', but the webServer at http:\/\/localhost:4820\/ already answers and reuseExistingServer is true\./,
  );
  assert.ok(warning?.endsWith(autoOff));
  assert.deepEqual(
    fake.setups.map(({ serverDir }) => serverDir),
    [undefined],
  );
});

test('init names every reuseExistingServer server that already answers', async (t) => {
  const fake = serverFake(t, {
    webServers: [
      { url: 'http://localhost:4820/', reuseExistingServer: true },
      { url: 'http://localhost:4821/', reuseExistingServer: true },
    ],
  });

  await assert.rejects(fake.runner().shell.init(), {
    message:
      /^lzPlaywright\.webServer\.mutate is true, but the webServer at http:\/\/localhost:4820\/, http:\/\/localhost:4821\/ already answers/,
  });
});

test('init starts a reuseExistingServer server that does not answer yet', async (t) => {
  const fake = serverFake(t, {
    webServers: [{ url: 'http://localhost:4820/', reuseExistingServer: true }],
    urlUp: async () => false,
  });

  await fake.runner().shell.init();

  assert.equal(fake.setups.length, 1);
});

const moved = {
  projects: [
    {
      default: true,
      project: {
        name: 'chromium',
        timeout: 30_000,
        use: { baseURL: 'http://127.0.0.1:4820' },
      },
    },
  ],
  webServers: [
    {
      url: 'http://127.0.0.1:4820/',
      command: 'serve --port 4820',
      env: { PORT: '4820' },
      reuseExistingServer: true,
    },
  ],
};

function movedPort(fake: { webServerOptions(): { url: string }[] }): number {
  const [options] = fake.webServerOptions();
  assert.ok(options);
  const port = Number(new URL(options.url).port);
  assert.notEqual(port, 4820);

  return port;
}

test('at concurrency 2, init moves the webServer to a port of its own before global setup, with the projects baseURL and PORT, though a sibling process answers on the configured one', async (t) => {
  stubEnv(t, { PORT: undefined, PLAYWRIGHT_TEST_BASE_URL: undefined });
  const fake = serverFake(t, {
    ...moved,
    urlUp: async (url) => url.port === '4820' || fake.setups.length > 0,
  });
  const { shell, lines } = fake.runner({ concurrency: 2 });

  await shell.init();
  await shell.dryRun(dryRunOptions());

  const port = movedPort(fake);
  assert.deepEqual(fake.webServerOptions(), [
    {
      url: `http://127.0.0.1:${port}/`,
      command: `serve --port ${port}`,
      env: { PORT: String(port) },
      reuseExistingServer: true,
    },
  ]);
  assert.deepEqual(fake.overrides()['use'], {
    screenshot: 'off',
    trace: 'off',
    video: 'off',
    baseURL: `http://127.0.0.1:${port}/`,
  });
  assert.equal(process.env['PORT'], String(port));
  assert.equal(fake.setups.length, 1);
  assert.deepEqual(fake.runs[0]?.settings.testIdHosts, [`localhost:${port}`]);
  assert.deepEqual(
    lines.filter(([, message]) => message.includes(' -> ')),
    [
      [
        'debug',
        `Stryker starts more than one test runner process, so this one's webServer moves to a port of its own: 4820 -> ${port}.`,
      ],
    ],
  );
});

test('at concurrency 2, init moves each webServer and names every move in one debug line', async (t) => {
  stubEnv(t, { PORT: undefined, PLAYWRIGHT_TEST_BASE_URL: undefined });
  const fake = serverFake(t, {
    projects: [
      { default: true, project: { name: 'chromium', timeout: 30_000 } },
    ],
    webServers: [
      { url: 'http://127.0.0.1:4820/' },
      { url: 'http://127.0.0.1:4821/' },
    ],
    urlUp: async () => false,
  });
  const { shell, lines } = fake.runner({ concurrency: 2 });

  await shell.init();

  const [first, second] = fake
    .webServerOptions()
    .map(({ url }) => new URL(url).port);
  assert.deepEqual(
    lines.filter(([, message]) => message.includes(' -> ')),
    [
      [
        'debug',
        `Stryker starts more than one test runner process, so this one's webServer moves to a port of its own: 4820 -> ${first}, 4821 -> ${second}.`,
      ],
    ],
  );
});

test('with a checker, init moves the webServer too', async (t) => {
  stubEnv(t, { PORT: undefined, PLAYWRIGHT_TEST_BASE_URL: undefined });
  const fake = serverFake(t, { ...moved, urlUp: async () => false });

  await fake.runner({ checkers: ['typescript'] }).shell.init();

  assert.equal(process.env['PORT'], String(movedPort(fake)));
});

test("with webServer.mutate: 'auto', init turns server support off with one warning, and moves no webServer, when the move refuses the projects' baseURL", async (t) => {
  stubEnv(t, { PORT: undefined, PLAYWRIGHT_TEST_BASE_URL: undefined });
  const fake = serverFake(t, {
    ...moved,
    projects: [
      {
        default: true,
        project: {
          name: 'chromium',
          timeout: 30_000,
          use: { baseURL: 'http://127.0.0.1:9999' },
        },
      },
    ],
    urlUp: async () => false,
  });
  const { shell, lines } = fake.runner({ mutate: 'auto', concurrency: 2 });

  await shell.init();

  assert.deepEqual(warnings(lines), [
    "lzPlaywright.webServer.mutate is 'auto' and Stryker starts more than one test runner process, so each process " +
      "needs a webServer port of its own, but the runner cannot move the projects' baseURL along: the baseURL " +
      "http://127.0.0.1:9999 points at no webServer. Point every project's baseURL at the url or port of the same " +
      'webServer, or leave it unset, or run Stryker with concurrency 1 and no checker (see More than one Stryker ' +
      'process in the README).' +
      autoOff,
  ]);
  assert.deepEqual(fake.webServerOptions(), moved.webServers);
  assert.deepEqual(
    fake.setups.map(({ serverDir }) => serverDir),
    [undefined],
  );
});

test('with one process and no checker, init keeps the configured port', async (t) => {
  stubEnv(t, { PORT: undefined });
  const fake = serverFake(t, { ...moved, urlUp: async () => false });

  await fake.runner().shell.init();

  assert.equal(fake.webServerOptions()[0]?.url, 'http://127.0.0.1:4820/');
  assert.deepEqual(fake.overrides()['use'], {
    screenshot: 'off',
    trace: 'off',
    video: 'off',
  });
  assert.equal(process.env['PORT'], undefined);
});

const boundMessage = (mutate: string, port: string | undefined) =>
  `lzPlaywright.webServer.mutate is ${mutate} and Stryker starts more than one test runner process, so each process's ` +
  'webServer moves to a port of its own, but the command of webServer 0 bound port 4820 instead of ' +
  `${port}. Make the command take its port from PORT, from the webServer's env, or from a --port in ` +
  'the command (the runner moves all three), or run Stryker with concurrency 1 and no checker (see More than ' +
  'one Stryker process in the README).';

function bindingFake(
  t: TestContext,
  globalSetup: NonNullable<Behaviour['globalSetup']>,
  urlUp: NonNullable<Behaviour['urlUp']>,
  mutate: true | 'auto' = true,
) {
  stubEnv(t, { PORT: undefined, PLAYWRIGHT_TEST_BASE_URL: undefined });
  const setupPorts: string[] = [];
  const fake = fakePlaywright(t, {
    ...moved,
    urlUp,
    globalSetup: (reporter) => {
      setupPorts.push(new URL(fake.webServerOptions()[0]?.url ?? '').port);

      return globalSetup(reporter);
    },
  });
  const runner = fake.runner({
    concurrency: 2,
    lzPlaywright: { webServer: { mutate } },
  });

  return {
    fake,
    setupPorts,
    lines: runner.lines,
    init: () => runner.shell.init(),
  };
}

function awaitSetupLeftRunning(t: TestContext): () => void {
  const done = Promise.withResolvers<void>();
  t.after(async () => {
    await done.promise;
    await setImmediate();
  });

  return () => done.resolve();
}

test('init that fails after moving the webServer puts its options and the environment back', async (t) => {
  let bound = false;
  const { fake, init } = bindingFake(
    t,
    () => {
      bound = true;

      return 'failed';
    },
    async (url) => bound && url.port === '4820',
  );

  await assert.rejects(init());

  assert.deepEqual(fake.webServerOptions(), moved.webServers);
  assert.equal(process.env['PORT'], undefined);
});

test("with webServer.mutate: 'auto', init turns server support off with one warning, and moves no webServer, when the command binds the configured port", async (t) => {
  let bound = false;
  const serverDirs: (string | undefined)[] = [];
  const setupDone = awaitSetupLeftRunning(t);
  const { fake, setupPorts, lines, init } = bindingFake(
    t,
    async (): Promise<Status> => {
      serverDirs.push(process.env[serverDirEnv]);

      if (process.env[serverDirEnv] === undefined) {
        return 'passed';
      }

      bound = true;
      await setTimeout(500);
      setupDone();

      return 'failed';
    },
    async (url) => bound && url.port === '4820',
    'auto',
  );

  await init();

  assert.deepEqual(warnings(lines), [
    boundMessage("'auto'", setupPorts[0]) + autoOff,
  ]);
  assert.equal(serverDirs.at(-1), undefined);
  assert.deepEqual(fake.webServerOptions(), moved.webServers);
  assert.deepEqual(fake.overrides()['use'], {
    screenshot: 'off',
    trace: 'off',
    video: 'off',
  });
  assert.equal(process.env['PORT'], undefined);
});

test('init names the command that bound the configured port while global setup still waits for the moved one', async (t) => {
  let bound = false;
  const setupDone = awaitSetupLeftRunning(t);
  const { setupPorts, init } = bindingFake(
    t,
    async (): Promise<Status> => {
      bound = true;
      await setTimeout(3000);
      setupDone();

      return 'failed';
    },
    async (url) => bound && url.port === '4820',
  );
  const started = performance.now();

  await assert.rejects(init(), (error) => {
    assert.ok(error instanceof Error);
    assert.equal(error.message, boundMessage('true', setupPorts[0]));
    assert.equal('cause' in error, false);

    return true;
  });
  assert.ok(
    performance.now() - started < 2000,
    'failed before global setup ended',
  );
});

test('init names the command that bound the configured port when global setup failed, with the failure as its cause', async (t) => {
  let bound = false;
  const { setupPorts, init } = bindingFake(
    t,
    () => {
      bound = true;

      return 'failed';
    },
    async (url) => bound && url.port === '4820',
  );

  await assert.rejects(init(), (error) => {
    assert.ok(error instanceof Error);
    assert.equal(error.message, boundMessage('true', setupPorts[0]));
    assert.match(String(error.cause), /^Error: Playwright global setup failed/);

    return true;
  });
});

test('a server that answered on the configured port before global setup is not blamed for a failed setup', async (t) => {
  const { init } = bindingFake(
    t,
    () => 'failed',
    async (url) => url.port === '4820',
  );

  await assert.rejects(init(), { message: /^Playwright global setup failed/ });
});

const autoOff =
  ' Server-side mutants stay NoCoverage in this run; lzPlaywright.webServer.mutate: true makes this an error instead.';

function warnings(lines: readonly (readonly [string, string])[]): string[] {
  return lines
    .filter(([level]) => level === 'warn')
    .map(([, message]) => message);
}

test("with webServer.mutate: 'auto', init turns server support off with one warning when no process global setup started loaded the server hook", async (t) => {
  const fake = serverFake(t, { hooked: false });
  const { shell, lines } = fake.runner({ mutate: 'auto' });

  await shell.init();
  await shell.dryRun(dryRunOptions());

  assert.deepEqual(warnings(lines), [
    "lzPlaywright.webServer.mutate is 'auto', but no process that Playwright global setup started loaded the server hook. " +
      'A webServer that is not Node.js, a command that sets NODE_OPTIONS itself, or a server that was already running ' +
      'cannot get the active mutant.' +
      autoOff,
  ]);
  assert.equal(fake.setups.at(-1)?.serverDir, undefined);
  assert.equal(fake.runs[0]?.settings.testIdHosts, undefined);
});

test("with webServer.mutate: 'auto', turning server support off at init repeats no warning init gave before", async (t) => {
  const fake = serverFake(t, { hooked: false });
  const { shell, lines } = fake.runner({ mutate: 'auto', timeoutMS: 100 });

  await shell.init();

  const [timeoutWarning, autoWarning, ...more] = warnings(lines);
  assert.match(timeoutWarning ?? '', /timeout/i);
  assert.ok(autoWarning?.endsWith(autoOff));
  assert.deepEqual(more, []);
});

test('init fails when no process global setup started loaded the server hook', async (t) => {
  const fake = serverFake(t, { hooked: false });

  await assert.rejects(fake.runner().shell.init(), {
    message:
      'lzPlaywright.webServer.mutate is true, but no process that Playwright global setup started loaded the server hook. ' +
      'A webServer that is not Node.js, a command that sets NODE_OPTIONS itself, or a server that was already running ' +
      'cannot get the active mutant.',
  });
});

test("with webServer.mutate: 'auto', a later webServer restart that loads no server hook fails with a message that says 'auto'", async (t) => {
  let hooks = true;
  const fake = serverFake(t, { hooked: () => hooks });
  const { shell } = fake.runner({ mutate: 'auto', isolate: false });
  await shell.init();
  hooks = false;

  await assert.rejects(
    shell.mutantRun(mutantRunOptions({ mutantActivation: 'static' })),
    {
      message:
        "lzPlaywright.webServer.mutate is 'auto', but no process that Playwright global setup started loaded the server hook. " +
        'A webServer that is not Node.js, a command that sets NODE_OPTIONS itself, or a server that was already running ' +
        'cannot get the active mutant.',
    },
  );
});
