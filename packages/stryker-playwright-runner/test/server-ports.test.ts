import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import net from 'node:net';
import { test } from 'node:test';

import { acceptsConnections } from '../src/server-checks.ts';
import type {
  ConfigProject,
  ConfigWebServer,
} from '../src/playwright-internals.ts';
import {
  freePort,
  moveServersApart,
  moveWebServerOptions,
  startsMoreRunners,
} from '../src/server-ports.ts';

const server = (
  fields: Pick<ConfigWebServer, 'url' | 'port'>,
): ConfigWebServer => ({
  ignoreHTTPSErrors: false,
  reuseExistingServer: true,
  setsNodeOptions: false,
  ...fields,
});
const project = (baseURL?: string): ConfigProject => ({
  default: true,
  project: { name: 'chromium', timeout: 1000, retries: 0 },
  baseURL,
});
const ports = (...given: number[]) => {
  const left = [...given];

  return async () => {
    const port = left.shift();
    assert.ok(port !== undefined, 'more ports asked for than given');

    return port;
  };
};

test('Stryker starts one test runner process at concurrency 1 without a checker', () => {
  assert.equal(startsMoreRunners({ concurrency: 1, checkers: [] }, 8), false);
});

test('Stryker starts more test runner processes at concurrency 2', () => {
  assert.equal(startsMoreRunners({ concurrency: 2, checkers: [] }, 8), true);
});

test('a checker process becomes another test runner process when checking ends', () => {
  assert.equal(
    startsMoreRunners({ concurrency: 1, checkers: ['typescript'] }, 8),
    true,
  );
});

test('a percentage concurrency is that share of the available parallelism', () => {
  assert.equal(
    startsMoreRunners({ concurrency: '50%', checkers: [] }, 8),
    true,
  );
});

test('a percentage concurrency rounds its share of the available parallelism', () => {
  assert.deepEqual(
    [
      startsMoreRunners({ concurrency: '10%', checkers: [] }, 8),
      startsMoreRunners({ concurrency: '100%', checkers: [] }, 2),
      startsMoreRunners({ concurrency: '100%', checkers: [] }, 1),
    ],
    [false, true, false],
  );
});

test("without a concurrency, Stryker's default starts more test runner processes on more than one core", () => {
  assert.equal(startsMoreRunners({ checkers: [] }, 2), true);
});

test('a free port accepts no connection', async () => {
  const port = await freePort();

  assert.ok(port > 0);
  assert.equal(await acceptsConnections(port), false);
});

function fakeListener(address: unknown, error?: Error) {
  const listened: unknown[] = [];
  const server = Object.assign(new EventEmitter(), {
    listen(port: number, host: string, listening: () => void) {
      listened.push([port, host]);

      if (error) {
        queueMicrotask(() => server.emit('error', error));
      } else {
        listening();
      }

      return server;
    },
    address: () => address,
    close(closed: () => void) {
      closed();
    },
  });

  return { server, listened };
}

test('a free port comes from the loopback interface', async (t) => {
  const { server, listened } = fakeListener({ port: 50_100 });
  t.mock.method(net, 'createServer', () => server);

  assert.equal(await freePort(), 50_100);
  assert.deepEqual(listened, [[0, '127.0.0.1']]);
});

test('a free port that cannot be bound rejects with the bind error', async (t) => {
  const error = new Error('EACCES');
  t.mock.method(net, 'createServer', () => fakeListener({}, error).server);

  await assert.rejects(freePort(), error);
});

test('a free port refuses a listener address that is no port', async (t) => {
  t.mock.method(
    net,
    'createServer',
    () => fakeListener('\\\\.\\pipe\\probe').server,
  );

  await assert.rejects(freePort(), {
    message: 'Port 0 bound to \\\\.\\pipe\\probe.',
  });
});

test('nothing moves when no webServer has a port or url', async () => {
  const apart = await moveServersApart(
    { projects: [project()], webServers: [server({})] },
    {},
    ports(),
  );

  assert.equal(apart, undefined);
});

test('a url webServer moves to a free port, and PORT names it', async () => {
  const apart = await moveServersApart(
    {
      projects: [project()],
      webServers: [server({ url: 'http://127.0.0.1:4830/health' })],
    },
    {},
    ports(50_001),
  );

  assert.deepEqual(apart, {
    moves: [{ index: 0, from: 4830, to: 50_001 }],
    webServers: [server({ url: 'http://127.0.0.1:50001/health' })],
    baseURL: undefined,
    env: { PORT: '50001' },
  });
});

test("the projects' baseURL moves with the webServer it names, in the first project's spelling", async () => {
  const apart = await moveServersApart(
    {
      projects: [
        project('http://localhost:4830'),
        project('http://127.0.0.1:4830/'),
      ],
      webServers: [server({ url: 'http://127.0.0.1:4830/health' })],
    },
    {},
    ports(50_001),
  );

  assert.equal(apart?.baseURL, 'http://localhost:50001/');
});

test('a port webServer moves to a free port', async () => {
  const apart = await moveServersApart(
    { projects: [project()], webServers: [server({ port: 3313 })] },
    {},
    ports(50_002),
  );

  assert.deepEqual(apart, {
    moves: [{ index: 0, from: 3313, to: 50_002 }],
    webServers: [server({ port: 50_002 })],
    baseURL: undefined,
    env: { PORT: '50002' },
  });
});

test('two webServers each move, and PORT is left alone since it could name only one of them', async () => {
  const apart = await moveServersApart(
    {
      projects: [project()],
      webServers: [
        server({ port: 3000 }),
        server({ url: 'http://localhost:3001/api' }),
        server({}),
      ],
    },
    {},
    ports(50_003, 50_004),
  );

  assert.deepEqual(apart, {
    moves: [
      { index: 0, from: 3000, to: 50_003 },
      { index: 1, from: 3001, to: 50_004 },
    ],
    webServers: [
      server({ port: 50_003 }),
      server({ url: 'http://localhost:50004/api' }),
      server({}),
    ],
    baseURL: undefined,
    env: {},
  });
});

test("a url without a port moves from its scheme's default port", async () => {
  const apart = await moveServersApart(
    {
      projects: [project()],
      webServers: [server({ url: 'https://localhost/api' })],
    },
    {},
    ports(50_004),
  );

  assert.ok(apart);
  assert.deepEqual(apart.moves, [{ index: 0, from: 443, to: 50_004 }]);
  assert.deepEqual(apart.webServers, [
    server({ url: 'https://localhost:50004/api' }),
  ]);
});

test('an http url without a port moves from port 80', async () => {
  const apart = await moveServersApart(
    {
      projects: [project()],
      webServers: [server({ url: 'http://localhost/api' })],
    },
    {},
    ports(50_005),
  );

  assert.deepEqual(apart?.moves, [{ index: 0, from: 80, to: 50_005 }]);
});

const cannotMove = (reason: string) =>
  "lzPlaywright.webServer.mutate is true and Stryker starts more than one test runner process, so each process needs a webServer port of its own, but the runner cannot move the projects' baseURL along: " +
  `${reason}. Point every project's baseURL at the url or port of the same webServer, or leave it unset, ` +
  'or run Stryker with concurrency 1 and no checker (see More than one Stryker process in the README).';

test('a baseURL that points at no webServer cannot be moved along', async () => {
  await assert.rejects(
    moveServersApart(
      {
        projects: [project('https://staging.example.com')],
        webServers: [server({ port: 3000 })],
      },
      {},
      ports(50_005),
    ),
    {
      message: cannotMove(
        'the baseURL https://staging.example.com points at no webServer',
      ),
    },
  );
});

test("every project's baseURL must name a moved webServer, and the refusal names each one that does not", async () => {
  await assert.rejects(
    moveServersApart(
      {
        projects: [
          project('http://localhost:3000'),
          project('https://staging.example.com'),
          project('nope'),
        ],
        webServers: [server({ port: 3000 })],
      },
      {},
      ports(50_005),
    ),
    {
      message: cannotMove(
        'the baseURL https://staging.example.com, nope points at no webServer',
      ),
    },
  );
});

test('projects whose baseURLs name different webServers cannot share the one baseURL the runner moves', async () => {
  await assert.rejects(
    moveServersApart(
      {
        projects: [
          project('http://localhost:3000'),
          project('http://localhost:3001'),
        ],
        webServers: [server({ port: 3000 }), server({ port: 3001 })],
      },
      {},
      ports(50_006, 50_007),
    ),
    {
      message: cannotMove(
        "the projects' baseURLs point at different webServers (http://localhost:3000, http://localhost:3001)",
      ),
    },
  );
});

test('moving a webServer rewrites the port of the url it waits for', () => {
  const options = {
    url: 'http://localhost:4200/health',
    reuseExistingServer: true,
  };

  moveWebServerOptions(options, 4200, 50_010);

  assert.deepEqual(options, {
    url: 'http://localhost:50010/health',
    reuseExistingServer: true,
  });
});

test('moving a webServer rewrites each env value that is its port, and only those', () => {
  const options = {
    env: { PORT: '4200', APP_PORT: '4200', OTHER: '42000', NODE_ENV: 'test' },
  };

  moveWebServerOptions(options, 4200, 50_010);

  assert.deepEqual(options, {
    env: { PORT: '50010', APP_PORT: '50010', OTHER: '42000', NODE_ENV: 'test' },
  });
});

test('moving a webServer rewrites its port where it stands as a word in the command', () => {
  const options = {
    command: 'npm run dev -- --port 4200 --host 0.0.0.0 -p 4200 --id 14200',
  };

  moveWebServerOptions(options, 4200, 50_010);

  assert.deepEqual(options, {
    command: 'npm run dev -- --port 50010 --host 0.0.0.0 -p 50010 --id 14200',
  });
});

test('moving a webServer leaves a url, env or command that is not what Playwright takes alone', () => {
  const options = { url: 1, env: 'x', command: 2 };

  moveWebServerOptions(options, 1, 2);

  assert.deepEqual(options, { url: 1, env: 'x', command: 2 });
});

test('PLAYWRIGHT_TEST_BASE_URL, which Playwright sets from a port webServer, moves with it', async () => {
  const apart = await moveServersApart(
    { projects: [project()], webServers: [server({ port: 3313 })] },
    { PLAYWRIGHT_TEST_BASE_URL: 'http://localhost:3313' },
    ports(50_002),
  );

  assert.deepEqual(apart?.env, {
    PORT: '50002',
    PLAYWRIGHT_TEST_BASE_URL: 'http://localhost:50002/',
  });
});
