// Server support in the runner's shell, against the fake Playwright install in support/fake-playwright.ts.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { type TestContext, test } from 'node:test';

import { DryRunStatus } from '@stryker-mutator/api/test-runner';

import { serverSide } from '../src/lz-playwright-test-runner.ts';
import { serializeSnapshot } from '../src/protocol.ts';
import {
  hookedPrefix,
  readServerControl,
  type ServerControl,
  serverDirEnv,
} from '../src/server-protocol.ts';
import {
  dryRunOptions,
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

function serverFake(
  t: TestContext,
  {
    hooked = true,
    ...behaviour
  }: Behaviour & { readonly hooked?: boolean } = {},
) {
  stubEnv(t, { NODE_OPTIONS: '--no-warnings' });
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

      if (hooked && serverDir !== undefined) {
        writeFileSync(path.join(serverDir, `${hookedPrefix}1`), '');
      }

      return 'passed';
    },
    runTests: async (run: Run) => {
      const serverDir = setups.at(-1)?.serverDir;
      assert.ok(serverDir);
      controls.push(readServerControl(serverDir));

      return (behaviour.runTests ?? passAll)(run);
    },
  });

  return {
    ...fake,
    runner: () =>
      fake.runner({ lzPlaywright: { webServer: { mutate: true } } }),
    setups,
    controls,
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

test("webServer.mutate: 'auto' leaves server mutants off for now and says so in one debug line", async (t) => {
  const setups: (string | undefined)[] = [];
  const fake = fakePlaywright(t, {
    webServers: [webServer],
    globalSetup: () => {
      setups.push(process.env[serverDirEnv]);

      return 'passed';
    },
  });
  const { shell, lines } = fake.runner({
    lzPlaywright: { webServer: { mutate: 'auto' } },
  });

  await shell.init();

  assert.deepEqual(setups, [undefined]);
  assert.deepEqual(
    lines.filter(([, message]) => /'auto'/.test(message)),
    [
      [
        'debug',
        "lzPlaywright.webServer.mutate: 'auto' is not built yet; server mutants stay off, as with false.",
      ],
    ],
  );
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

test('each run writes the control file before its tests run, and a per-test dry run names the webServer hosts', async (t) => {
  const fake = serverFake(t);
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

test('in arrival mode no test id header is asked for', async (t) => {
  const server = await serverSide(
    { mode: 'arrival' },
    { dir: tempTree(t, 'server-side-') },
    [
      {
        ...webServer,
        ignoreHTTPSErrors: false,
        reuseExistingServer: false,
        setsNodeOptions: false,
      },
    ],
    async () => false,
  );

  assert.equal(server?.testIdHosts, undefined);
});

test('a static mutant run restarts the webServer with that mutant, and the next runtime run restarts it without', async (t) => {
  const fake = serverFake(t);
  const { shell } = fake.runner();
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
  const { shell } = fake.runner();
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

test('init refuses a reuseExistingServer server that already answers, and starts one that does not', async (t) => {
  const shared = serverFake(t, {
    webServers: [{ url: 'http://localhost:4820/', reuseExistingServer: true }],
  });

  await assert.rejects(shared.runner().shell.init(), (error) => {
    assert.ok(error instanceof Error);
    assert.match(
      error.message,
      /^lzPlaywright\.webServer\.mutate is true, but the webServer at http:\/\/localhost:4820\/ already answers and reuseExistingServer is true\./,
    );

    return true;
  });
  assert.deepEqual(shared.setups, []);
});

test('init starts a reuseExistingServer server that does not answer yet', async (t) => {
  const fake = serverFake(t, {
    webServers: [{ url: 'http://localhost:4820/', reuseExistingServer: true }],
    urlUp: async () => false,
  });

  await fake.runner().shell.init();

  assert.equal(fake.setups.length, 1);
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
