import assert from 'node:assert/strict';
import { type TestContext, test } from 'node:test';
import { setImmediate, setTimeout } from 'node:timers/promises';

import { serverDirEnv } from '../src/server-protocol.ts';
import { dryRunOptions, warnings } from './support/doubles.ts';
import {
  type Behaviour,
  fakePlaywright,
  type Status,
  stubEnv,
} from './support/fake-playwright.ts';
import { autoOff, serverFake } from './support/server-fake.ts';

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
    "lzPlaywright.webServer.mutate is 'auto', but Stryker starts more than one test runner process, so each process " +
      "needs a webServer port of its own, and the runner cannot move the projects' baseURL along: the baseURL " +
      'http://127.0.0.1:9999 points at no webServer. Point the baseURL of every project that runs at the url or port ' +
      'of the same webServer, or leave it unset, or run Stryker with concurrency 1 and no checker (see More than one Stryker ' +
      'process in the README).' +
      autoOff,
  ]);
  assert.deepEqual(fake.webServerOptions(), moved.webServers);
  assert.deepEqual(
    fake.setups.map(({ serverDir }) => serverDir),
    [undefined],
  );
});

test('at concurrency 2, init moves the webServer though a project that never runs has its baseURL elsewhere', async (t) => {
  stubEnv(t, { PORT: undefined, PLAYWRIGHT_TEST_BASE_URL: undefined });
  const fake = serverFake(t, {
    ...moved,
    projects: [
      ...moved.projects,
      {
        default: false,
        project: {
          name: 'staging',
          timeout: 30_000,
          use: { baseURL: 'https://staging.example.com' },
        },
      },
    ],
    urlUp: async () => false,
  });

  await fake.runner({ concurrency: 2 }).shell.init();

  assert.equal(process.env['PORT'], String(movedPort(fake)));
});

test('at concurrency 2, init moves the webServer though a project that lzPlaywright.projects leaves out has its baseURL elsewhere', async (t) => {
  stubEnv(t, { PORT: undefined, PLAYWRIGHT_TEST_BASE_URL: undefined });
  const fake = serverFake(t, {
    ...moved,
    projects: [
      ...moved.projects,
      {
        default: true,
        project: {
          name: 'staging',
          timeout: 30_000,
          use: { baseURL: 'https://staging.example.com' },
        },
      },
    ],
    urlUp: async () => false,
  });

  await fake.runner({ concurrency: 2, projects: ['chromium'] }).shell.init();

  assert.equal(process.env['PORT'], String(movedPort(fake)));
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
  `lzPlaywright.webServer.mutate is ${mutate}, but Stryker starts more than one test runner process, so each process's ` +
  'webServer moves to a port of its own, and the command of webServer 0 bound port 4820 instead of ' +
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

test("with webServer.mutate: 'auto', init turns server support off with one warning that names the configured port and the setup error when global setup fails while another server answered there from the start", async (t) => {
  const serverDirs: (string | undefined)[] = [];
  const { fake, lines, init } = bindingFake(
    t,
    (reporter) => {
      serverDirs.push(process.env[serverDirEnv]);

      if (process.env[serverDirEnv] === undefined) {
        return 'passed';
      }

      reporter.onError?.({ message: 'listen EADDRINUSE' });

      return 'failed';
    },
    async (url) => url.port === '4820',
    'auto',
  );

  await init();

  assert.deepEqual(warnings(lines), [
    "lzPlaywright.webServer.mutate is 'auto', but Stryker starts more than one test runner process, so each " +
      "process's webServer moves to a port of its own, and global setup failed (Playwright global setup failed:\n" +
      'listen EADDRINUSE) while another server answered on port 4820, the configured port of webServer 0, such as the webServer of a process that turned server ' +
      "support off. Make the command take its port from PORT, from the webServer's env, or from a --port in the " +
      'command (the runner moves all three), or run Stryker with concurrency 1 and no checker (see More than one ' +
      'Stryker process in the README).' +
      autoOff,
  ]);
  assert.equal(serverDirs.at(-1), undefined);
  assert.deepEqual(fake.webServerOptions(), moved.webServers);
});

test('a server that answered on the configured port before global setup is not blamed for a failed setup', async (t) => {
  const { init } = bindingFake(
    t,
    () => 'failed',
    async (url) => url.port === '4820',
  );

  await assert.rejects(init(), { message: /^Playwright global setup failed/ });
});
