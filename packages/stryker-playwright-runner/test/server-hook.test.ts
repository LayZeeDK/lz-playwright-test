import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import http from 'node:http';
import http2 from 'node:http2';
import https from 'node:https';
import path from 'node:path';
import { before, type TestContext, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { INSTRUMENTER_CONSTANTS } from '@stryker-mutator/api/core';
import { Instrumenter } from '@stryker-mutator/instrumenter';

import { readSnapshotDir } from '../src/protocol.ts';
import { mergeCoverage } from '../src/run-result.ts';
import {
  anyHooked,
  type ServerControl,
  serverDirEnv,
  serverSnapshotPrefix,
  testIdHeader,
  untaggedArrival,
  writeServerControl,
} from '../src/server-protocol.ts';
import { logger, tempTree, withoutPrototypes } from './support/doubles.ts';

const serverHookUrl = new URL('../src/server-hook.ts', import.meta.url).href;
const tlsKeyPath = fileURLToPath(
  new URL('support/tls/localhost-key.pem', import.meta.url),
);
const tlsCertPath = fileURLToPath(
  new URL('support/tls/localhost-cert.pem', import.meta.url),
);
// Mutant ids the instrumenter gives this source: 0 is 'hi', run once at module scope; 2 makes the condition
// true; 6 empties ' many'; 7 empties 'one'.
const source = [
  "const greeting = 'hi';",
  'export function answer(n) {',
  "  return n > 1 ? greeting + ' many' : 'one';",
  '}',
  '',
].join('\n');
const bigRequestIds = ['1', '2', '3', '4', '5', '6'];
const testIdsTheseTestsSend = ['big', 'small'];
const namespaceGlobal = `globalThis.${INSTRUMENTER_CONSTANTS.NAMESPACE}`;
const answerLines = [
  "const n = Number(new URL(request.url, 'http://x').searchParams.get('n'));",
  'response.end(answer(n));',
];
const answerImport = "import { answer } from './app.mjs';";
const serverSource = serverSourceOf(answerLines, [answerImport]);
const selfRequestLines = [
  "const url = new URL(request.url, 'http://x');",
  "if (url.pathname === '/redirect') {",
  "  response.writeHead(302, { location: `http://127.0.0.1:${url.searchParams.get('to')}/` });",
  '  response.end();',
  '  return;',
  '}',
  "if (url.pathname === '/late') {",
  "  const self = `http://127.0.0.1:${server.address().port}/?n=${url.searchParams.get('n')}`;",
  '  globalThis.late = new Promise((resolve) => setTimeout(resolve, 20)).then(() => fetch(self)).then((answer) => answer.text());',
  "  response.end('sent later');",
  '  return;',
  '}',
  "if (url.pathname === '/late-answer') {",
  '  response.end(await globalThis.late);',
  '  return;',
  '}',
  "if (url.pathname === '/secure-port') {",
  '  response.end(String(secure.address().port));',
  '  return;',
  '}',
  "if (url.pathname !== '/') {",
  "  const scheme = url.searchParams.get('scheme') ?? 'http';",
  "  const port = url.searchParams.get('port') ?? (scheme === 'https' ? secure : server).address().port;",
  "  const self = `${scheme}://127.0.0.1:${port}/${url.searchParams.get('then') ?? ''}?${url.searchParams}`;",
  '  response.end(await clients[url.pathname.slice(1)](self, request));',
  '  return;',
  '}',
  ...answerLines,
];
const selfRequestClients = [
  "import https from 'node:https';",
  "import { readFileSync } from 'node:fs';",
  "import { get as namedGet } from 'node:http';",
  `const tls = { key: readFileSync(${JSON.stringify(tlsKeyPath)}), cert: readFileSync(${JSON.stringify(tlsCertPath)}) };`,
  'const secure = https.createServer(tls, (request, response) => {',
  "  response.end(answer(Number(new URL(request.url, 'http://x').searchParams.get('n'))));",
  '});',
  "secure.listen(0, '127.0.0.1');",
  'const ca = tls.cert;',
  'const optionsOf = (url) => {',
  '  const { hostname, port, pathname, search } = new URL(url);',
  '  return { hostname, port, path: pathname + search, ca };',
  '};',
  'const sent = (request) => {',
  '  request.end();',
  '  return request;',
  '};',
  'const textOf = (request) => new Promise((resolve, reject) => {',
  "  request.on('error', reject);",
  "  request.on('response', (response) => {",
  "    response.setEncoding('utf8');",
  "    let body = '';",
  "    response.on('data', (chunk) => (body += chunk));",
  "    response.on('end', () => resolve(body));",
  '  });',
  '});',
  'const clients = {',
  "  'fetch-string': async (url) => (await fetch(url)).text(),",
  "  'http-get-url': (url) => textOf(http.get(new URL(url))),",
  "  'fetch-url': async (url) => (await fetch(new URL(url))).text(),",
  "  'fetch-request': async (url) => (await fetch(new Request(url))).text(),",
  "  'http-get-options': (url) => textOf(http.get(optionsOf(url))),",
  "  'http-get-named-import': (url) => textOf(namedGet(url)),",
  "  'http-request-url': (url) => textOf(sent(http.request(new URL(url)))),",
  "  'http-request-options': (url) => textOf(sent(http.request(optionsOf(url)))),",
  "  'https-get-url': (url) => textOf(https.get(new URL(url), { ca })),",
  "  'https-request-options': (url) => textOf(sent(https.request(optionsOf(url)))),",
  `  'fetch-own-header': async (url) => (await fetch(url, { headers: { '${testIdHeader}': 'small' } })).text(),`,
  `  'http-get-own-header': (url) => textOf(http.get(url, { headers: { '${testIdHeader}': 'small' } })),`,
  "  'http-get-own-host': (url) => textOf(http.get(url, { headers: { host: `127.0.0.1:${server.address().port}` } })),",
  `  'fetch-forward': async (url, incoming) => (await fetch(url, { headers: { '${testIdHeader}': incoming.headers['${testIdHeader}'] } })).text(),`,
  "  'http-get-bad-host': async () => {",
  "    const kind = (error) => (error instanceof TypeError ? 'TypeError' : 'other');",
  '    try {',
  "      return await textOf(http.get({ hostname: 'a b', port: 1 })).then(() => 'answered', kind);",
  '    } catch (error) {',
  '      return kind(error);',
  '    }',
  '  },',
  "  'http-request-array-headers': (url) => textOf(sent(http.request(url, { headers: ['host', new URL(url).host] }))),",
  '};',
];
const selfRequestServerSource = serverSourceOf(selfRequestLines, [
  answerImport,
  ...selfRequestClients,
]);
const lazyServerSource = serverSourceOf([
  "const { answer } = await import('./app.mjs');",
  ...answerLines,
]);
const withoutTestRunnerHooksAndActiveMutant = {
  NODE_OPTIONS: undefined,
  [INSTRUMENTER_CONSTANTS.ACTIVE_MUTANT_ENV_VARIABLE]: undefined,
};
let instrumented = '';
let appMutantIds: ReadonlySet<string> = new Set();

before(async () => {
  const result = await new Instrumenter(logger().log).instrument(
    [{ name: 'app.mjs', content: source, mutate: true }],
    { plugins: null, excludedMutations: [], ignorers: [] },
  );
  const [file] = result.files;
  assert.ok(file);
  assert.deepEqual(
    result.mutants.map(({ id, replacement }) => `${id} ${replacement}`),
    [
      '0 ""',
      '1 {}',
      '2 true',
      '3 false',
      '4 n >= 1',
      '5 n <= 1',
      '6 ""',
      '7 ""',
    ],
  );
  instrumented = file.content;
  appMutantIds = new Set(result.mutants.map(({ id }) => id));
});

function serverSourceOf(
  handler: readonly string[],
  imports: readonly string[] = [],
  createServerCall = 'http.createServer(',
): string {
  return [
    "import http from 'node:http';",
    "import http2 from 'node:http2';",
    ...imports,
    `const server = ${createServerCall}async (request, response) => {`,
    ...handler.map((line) => `  ${line}`),
    '});',
    "server.listen(0, '127.0.0.1', () => process.stdout.write(`${server.address().port}\\n`));",
    '',
  ].join('\n');
}

async function startServer(
  t: TestContext,
  {
    env = {},
    server = serverSource,
    hooks = [serverHookUrl],
  }: {
    readonly env?: Readonly<Record<string, string>>;
    readonly server?: string;
    readonly hooks?: readonly string[];
  } = {},
) {
  const dir = tempTree(t, 'server-hook-test-', {
    'app.mjs': instrumented,
    'server.mjs': server,
  });
  const serverDir = path.join(dir, 'server');
  mkdirSync(serverDir);
  const child = spawn(
    process.execPath,
    [
      ...hooks.flatMap((hook) => ['--import', hook]),
      path.join(dir, 'server.mjs'),
    ],
    {
      env: {
        ...process.env,
        ...withoutTestRunnerHooksAndActiveMutant,
        [serverDirEnv]: serverDir,
        ...env,
      },
      stdio: ['ignore', 'pipe', 'inherit'],
    },
  );
  t.after(async () => {
    child.kill();
    await once(child, 'exit');
  });
  const listened: unknown[] = await once(child.stdout, 'data');
  const port = Number(String(listened[0]).trim());
  let runs = 0;

  return {
    serverDir,
    port,
    run(control: Omit<ServerControl, 'outDir'>) {
      const outDir = path.join(dir, 'runs', String(runs++));
      mkdirSync(outDir, { recursive: true });
      writeServerControl(serverDir, {
        outDir,
        issuedTestIds: testIdsTheseTestsSend,
        testIdHosts: [`localhost:${port}`],
        ...control,
      });

      return outDir;
    },
    async ask(
      n: number,
      testId?: string,
      via = '',
      query: Readonly<Record<string, string>> = {},
    ): Promise<string> {
      const search = new URLSearchParams({ n: String(n), ...query });
      const response = await fetch(
        `http://127.0.0.1:${port}/${via}?${search}`,
        {
          headers: testId === undefined ? {} : { [testIdHeader]: testId },
        },
      );

      return response.text();
    },
  };
}

async function startHeaderEcho(t: TestContext): Promise<number> {
  const echo = http.createServer((request, response) =>
    response.end(String(request.headers[testIdHeader])),
  );
  echo.listen(0, '127.0.0.1');
  await once(echo, 'listening');
  t.after(() => echo.close());
  const address = echo.address();
  assert.ok(address !== null && typeof address === 'object');

  return address.port;
}

function secureHttp2ServerSource(options: string): string {
  return serverSourceOf(
    answerLines,
    ["import { readFileSync } from 'node:fs';", answerImport],
    `http2.createSecureServer({ ...${options}, key: readFileSync(${JSON.stringify(tlsKeyPath)}), cert: readFileSync(${JSON.stringify(tlsCertPath)}) }, `,
  );
}

async function askHttp2(
  origin: string,
  n: number,
  options: http2.SecureClientSessionOptions = {},
  headers: http2.OutgoingHttpHeaders = {},
): Promise<string> {
  const session = http2.connect(origin, options);

  try {
    const stream = session.request({ ':path': `/?n=${n}`, ...headers });
    stream.setEncoding('utf8');
    const chunks: string[] = [];
    stream.on('data', (chunk: string) => chunks.push(chunk));
    await once(stream, 'end');

    return chunks.join('');
  } finally {
    session.close();
  }
}

function coverageOf(outDir: string) {
  return mergeCoverage(readSnapshotDir(outDir).snapshots);
}

function appMutantIdsOf(hits: Record<string, number> | undefined): string[] {
  return Object.keys(hits ?? {})
    .filter((id) => appMutantIds.has(id))
    .sort();
}

test('the hook marks its server hooked once it listens', async (t) => {
  const server = await startServer(t);

  assert.equal(anyHooked(server.serverDir), true);
});

test('the active mutant switches per request from the control file, without a restart', async (t) => {
  const server = await startServer(t);

  assert.equal(await server.ask(0), 'one', 'no control file yet');

  server.run({ perTest: false, activeMutant: '2' });

  assert.equal(await server.ask(0), 'hi many');

  server.run({ perTest: false, activeMutant: '7' });

  assert.equal(await server.ask(0), '');
  assert.equal(await server.ask(2), 'hi many');

  server.run({ perTest: false });

  assert.equal(await server.ask(0), 'one');
});

test('an http2 server switches the active mutant per request too', async (t) => {
  const server = await startServer(t, {
    server: serverSourceOf(answerLines, [answerImport], 'http2.createServer('),
  });
  server.run({ perTest: false, activeMutant: '2' });

  assert.equal(await askHttp2(`http://127.0.0.1:${server.port}`, 0), 'hi many');
});

test('an http2 server is marked hooked once it listens', async (t) => {
  const server = await startServer(t, {
    server: serverSourceOf(answerLines, [answerImport], 'http2.createServer('),
  });

  assert.equal(anyHooked(server.serverDir), true);
});

test('an http2 server collects coverage per test id header', async (t) => {
  const server = await startServer(t, {
    server: serverSourceOf(answerLines, [answerImport], 'http2.createServer('),
  });
  const outDir = server.run({ perTest: true });
  await askHttp2(
    `http://127.0.0.1:${server.port}`,
    2,
    {},
    { [testIdHeader]: 'big' },
  );

  assert.deepEqual(
    appMutantIdsOf(coverageOf(outDir).perTest['big']),
    bigRequestIds,
  );
});

test('a secure http2 server switches the active mutant per request too', async (t) => {
  const server = await startServer(t, {
    server: secureHttp2ServerSource('{}'),
  });
  server.run({ perTest: false, activeMutant: '2' });

  assert.equal(
    await askHttp2(`https://127.0.0.1:${server.port}`, 0, {
      ca: readFileSync(tlsCertPath),
    }),
    'hi many',
  );
});

test('a secure http2 server that allows HTTP/1 switches the active mutant for an HTTP/1 request too', async (t) => {
  const server = await startServer(t, {
    server: secureHttp2ServerSource('{ allowHTTP1: true }'),
  });
  server.run({ perTest: false, activeMutant: '2' });
  const request = https.get(`https://127.0.0.1:${server.port}/?n=0`, {
    ca: readFileSync(tlsCertPath),
  });
  const responded: unknown[] = await once(request, 'response');
  const [response] = responded;
  assert.ok(response instanceof http.IncomingMessage);
  response.setEncoding('utf8');

  assert.equal((await response.toArray()).join(''), 'hi many');
});

test('a mutant run once at module scope is active only in a server started with it', async (t) => {
  const switched = await startServer(t);
  switched.run({ perTest: false, activeMutant: '0' });

  assert.equal(await switched.ask(2), 'hi many');

  const started = await startServer(t, {
    env: { [INSTRUMENTER_CONSTANTS.ACTIVE_MUTANT_ENV_VARIABLE]: '0' },
  });
  started.run({ perTest: false, activeMutant: '0' });

  assert.equal(await started.ask(2), ' many');
});

test('coverage goes to the run folder per test id header, with what ran before the first run as static', async (t) => {
  const server = await startServer(t);
  await server.ask(2, 'before-any-run');
  const first = server.run({ perTest: true });
  await Promise.all([server.ask(2, 'big'), server.ask(0, 'small')]);
  const second = server.run({ perTest: true });
  await server.ask(0, 'small');

  const coverage = coverageOf(first);

  assert.ok(
    readdirSync(first).every((file) => file.startsWith(serverSnapshotPrefix)),
  );
  assert.deepEqual(
    appMutantIdsOf(coverage.static),
    ['0', '1', '2', '3', '4', '5', '6'],
    'module scope, and a request before any run, such as a readiness check',
  );
  assert.deepEqual(appMutantIdsOf(coverage.perTest['big']), bigRequestIds);
  assert.deepEqual(appMutantIdsOf(coverage.perTest['small']), [
    '1',
    '2',
    '3',
    '4',
    '5',
    '7',
  ]);
  assert.equal(coverage.perTest['before-any-run'], undefined);
  assert.deepEqual(
    withoutPrototypes(coverageOf(second)),
    withoutPrototypes({
      static: {},
      perTest: { small: coverage.perTest['small'] },
    }),
    'each run gets only its own hits',
  );
});

test("module scope evaluated lazily inside a request is static, and the rest of that request is its test's", async (t) => {
  const server = await startServer(t, { server: lazyServerSource });
  const outDir = server.run({ perTest: true });
  await server.ask(2, 'big');

  const coverage = coverageOf(outDir);

  assert.deepEqual(appMutantIdsOf(coverage.static), ['0']);
  assert.deepEqual(appMutantIdsOf(coverage.perTest['big']), bigRequestIds);
});

test('hits count as static only until the microtask after the first read of the namespace global', async (t) => {
  const server = await startServer(t, {
    server: serverSourceOf([
      `const ns = ${namespaceGlobal};`,
      'const during = ns.currentTestId;',
      'await null;',
      'response.end(JSON.stringify([during, ns.currentTestId]));',
    ]),
  });
  server.run({ perTest: true });

  assert.equal(await server.ask(0, 'small'), '[null,"small"]');
});

test('a read of the namespace global inside an open window does not keep it open', async (t) => {
  const server = await startServer(t, {
    server: serverSourceOf([
      `queueMicrotask(() => ${namespaceGlobal});`,
      `const ns = ${namespaceGlobal};`,
      'await null;',
      'response.end(String(ns.currentTestId));',
    ]),
  });
  server.run({ perTest: true });

  assert.equal(await server.ask(0, 'small'), 'small');
});

test('a read of the namespace global inside an open window schedules no close that ends a later window early', async (t) => {
  const server = await startServer(t, {
    server: serverSourceOf([
      `queueMicrotask(() => ${namespaceGlobal});`,
      `const ns = ${namespaceGlobal};`,
      'const later = await new Promise((resolve) => {',
      '  queueMicrotask(() => {',
      '    queueMicrotask(() => resolve(ns.currentTestId));',
      `    ${namespaceGlobal};`,
      '  });',
      '});',
      'response.end(JSON.stringify([later]));',
    ]),
  });
  server.run({ perTest: true });

  assert.equal(await server.ask(0, 'small'), '[null]');
});

test('code that runs outside any request names no test', async (t) => {
  const server = await startServer(t, {
    server: serverSourceOf(
      [
        'const outside = await new Promise((resolve) => waiting.push(resolve));',
        'response.end(String(outside));',
      ],
      [
        `const ns = ${namespaceGlobal};`,
        'const waiting = [];',
        'setInterval(() => waiting.splice(0).forEach((resolve) => resolve(ns.currentTestId)), 5).unref();',
      ],
    ),
  });
  server.run({ perTest: true });

  assert.equal(await server.ask(0, 'small'), 'undefined');
});

test('a second copy of the hook leaves lazily evaluated module scope static', async (t) => {
  const server = await startServer(t, {
    server: lazyServerSource,
    hooks: [serverHookUrl, `${serverHookUrl}?copy`],
  });
  const outDir = server.run({ perTest: true });
  await server.ask(2, 'big');

  const coverage = coverageOf(outDir);

  assert.deepEqual(appMutantIdsOf(coverage.static), ['0']);
  assert.deepEqual(appMutantIdsOf(coverage.perTest['big']), bigRequestIds);
});

test('without per-test coverage lazily evaluated module scope and the request are static', async (t) => {
  const server = await startServer(t, { server: lazyServerSource });
  const outDir = server.run({ perTest: false });
  await server.ask(2, 'big');

  const coverage = coverageOf(outDir);

  assert.deepEqual(Object.keys(coverage.perTest), []);
  assert.deepEqual(appMutantIdsOf(coverage.static), [
    '0',
    '1',
    '2',
    '3',
    '4',
    '5',
    '6',
  ]);
});

test('assigning the namespace global is ignored, not a throw', async (t) => {
  const server = await startServer(t, {
    server: serverSourceOf([
      `const before = ${namespaceGlobal};`,
      'try {',
      `  ${namespaceGlobal} = {};`,
      '} catch (error) {',
      '  response.end(String(error));',
      '  return;',
      '}',
      `response.end(String(${namespaceGlobal} === before));`,
    ]),
  });

  assert.equal(await server.ask(0), 'true');
});

[
  { client: 'fetch-string', how: 'fetch and a string url' },
  { client: 'http-get-url', how: 'http.get and a URL' },
  { client: 'fetch-url', how: 'fetch and a URL' },
  { client: 'fetch-request', how: 'fetch and a Request' },
  { client: 'http-get-options', how: 'http.get and options' },
  { client: 'http-get-named-import', how: 'a named import of get' },
  { client: 'http-request-url', how: 'http.request and a URL' },
  { client: 'http-request-options', how: 'http.request and options' },
  { client: 'https-get-url', how: 'https.get and a URL', scheme: 'https' },
  {
    client: 'https-request-options',
    how: 'https.request and options',
    scheme: 'https',
  },
].forEach(({ client, how, scheme = 'http' }) => {
  test(`a request the server sends itself with ${how} counts under the test of the request that sent it`, async (t) => {
    const server = await startServer(t, { server: selfRequestServerSource });
    const securePort = await server.ask(0, undefined, 'secure-port');
    const outDir = server.run({
      perTest: true,
      testIdHosts: [`localhost:${server.port}`, `localhost:${securePort}`],
    });

    assert.equal(await server.ask(2, 'big', client, { scheme }), 'hi many');
    assert.deepEqual(
      appMutantIdsOf(coverageOf(outDir).perTest['big']),
      bigRequestIds,
    );
  });
});

[
  { client: 'fetch-own-header', how: 'fetch' },
  { client: 'http-get-own-header', how: 'http.get' },
].forEach(({ client, how }) => {
  test(`a test id header the server sets on a request to itself with ${how} is kept`, async (t) => {
    const server = await startServer(t, { server: selfRequestServerSource });
    const outDir = server.run({ perTest: true });

    assert.equal(await server.ask(2, 'big', client), 'hi many');

    const coverage = coverageOf(outDir);

    assert.deepEqual(appMutantIdsOf(coverage.perTest['small']), bigRequestIds);
    assert.deepEqual(appMutantIdsOf(coverage.perTest['big']), []);
  });
});

[
  { why: 'without a test id header', testId: undefined },
  { why: 'with a test id the runner did not issue', testId: '__proto__' },
].forEach(({ why, testId }) => {
  test(`a request the server sends itself for a request ${why} names no test`, async (t) => {
    const server = await startServer(t, { server: selfRequestServerSource });
    const outDir = server.run({ perTest: true });

    assert.equal(await server.ask(2, testId, 'fetch-string'), 'hi many');

    const keys = readSnapshotDir(outDir).snapshots.flatMap(({ coverage }) =>
      Object.keys(coverage?.perTest ?? {}),
    );

    assert.ok(keys.length > 0);
    assert.ok(
      keys.every((key) => untaggedArrival(key) !== undefined),
      keys.join(),
    );
  });
});

test('requests two tests make at once each send their own test id to the server itself', async (t) => {
  const server = await startServer(t, { server: selfRequestServerSource });
  const outDir = server.run({ perTest: true });

  await Promise.all([
    server.ask(2, 'big', 'fetch-string'),
    server.ask(0, 'small', 'http-get-url'),
    server.ask(2, 'big', 'http-get-url'),
    server.ask(0, 'small', 'fetch-string'),
  ]);

  const coverage = coverageOf(outDir);

  assert.deepEqual(appMutantIdsOf(coverage.perTest['big']), bigRequestIds);
  assert.deepEqual(appMutantIdsOf(coverage.perTest['small']), [
    '1',
    '2',
    '3',
    '4',
    '5',
    '7',
  ]);
});

test('without per-test coverage a request the server sends itself is static', async (t) => {
  const server = await startServer(t, { server: selfRequestServerSource });
  const outDir = server.run({ perTest: false });

  assert.equal(await server.ask(2, 'big', 'fetch-string'), 'hi many');

  const coverage = coverageOf(outDir);

  assert.deepEqual(Object.keys(coverage.perTest), []);
  assert.deepEqual(appMutantIdsOf(coverage.static), [
    '0',
    '1',
    '2',
    '3',
    '4',
    '5',
    '6',
  ]);
});

test('a request the server sends itself after the response ended still counts under the test of the request that started it', async (t) => {
  const server = await startServer(t, { server: selfRequestServerSource });
  const outDir = server.run({ perTest: true });

  assert.equal(await server.ask(2, 'big', 'late'), 'sent later');
  assert.equal(await server.ask(0, undefined, 'late-answer'), 'hi many');
  assert.deepEqual(
    appMutantIdsOf(coverageOf(outDir).perTest['big']),
    bigRequestIds,
  );
});

test('a test id header the server forwards to a second hooked server counts there under the same test', async (t) => {
  const second = await startServer(t);
  const secondOutDir = second.run({ perTest: true });
  const first = await startServer(t, { server: selfRequestServerSource });
  first.run({ perTest: true });

  assert.equal(
    await first.ask(2, 'big', 'fetch-forward', { port: String(second.port) }),
    'hi many',
  );
  assert.deepEqual(
    appMutantIdsOf(coverageOf(secondOutDir).perTest['big']),
    bigRequestIds,
  );
});

test('a request to a host name a URL cannot hold fails as it would without the hook', async (t) => {
  const server = await startServer(t, { server: selfRequestServerSource });
  server.run({ perTest: true });

  assert.equal(await server.ask(2, 'big', 'http-get-bad-host'), 'other');
});

test('a request the server sends itself with raw array headers still goes out, without the test id', async (t) => {
  const server = await startServer(t, { server: selfRequestServerSource });
  const outDir = server.run({ perTest: true });

  assert.equal(
    await server.ask(2, 'big', 'http-request-array-headers'),
    'hi many',
  );
  assert.deepEqual(appMutantIdsOf(coverageOf(outDir).perTest['big']), []);
});

test('a request the server sends to another host gets no test id header', async (t) => {
  const otherPort = await startHeaderEcho(t);
  const server = await startServer(t, { server: selfRequestServerSource });
  server.run({ perTest: true });

  assert.equal(
    await server.ask(2, 'big', 'fetch-string', { port: String(otherPort) }),
    'undefined',
  );
});

test("a request the server sends to another port with the server's own Host header gets no test id header", async (t) => {
  const otherPort = await startHeaderEcho(t);
  const server = await startServer(t, { server: selfRequestServerSource });
  server.run({ perTest: true });

  assert.equal(
    await server.ask(2, 'big', 'http-get-own-host', {
      port: String(otherPort),
    }),
    'undefined',
  );
});

test('a redirect from the server to another host carries no test id header', async (t) => {
  const otherPort = await startHeaderEcho(t);
  const server = await startServer(t, { server: selfRequestServerSource });
  server.run({ perTest: true });

  assert.equal(
    await server.ask(2, 'big', 'fetch-string', {
      then: 'redirect',
      to: String(otherPort),
    }),
    'undefined',
  );
});

test('a request without the header counts under its arrival time', async (t) => {
  const server = await startServer(t);
  await server.ask(2);
  const outDir = server.run({ perTest: true });
  const sent = Date.now();
  await server.ask(0);
  const answered = Date.now();

  const keys = readSnapshotDir(outDir).snapshots.flatMap(({ coverage }) =>
    Object.keys(coverage?.perTest ?? {}),
  );

  assert.equal(keys.length, 1);
  const [key = ''] = keys;
  const arrivedAt = untaggedArrival(key);
  const crossProcessClockSkewMs = 50;
  assert.ok(
    arrivedAt !== undefined &&
      sent - crossProcessClockSkewMs <= arrivedAt &&
      arrivedAt <= answered + crossProcessClockSkewMs,
    `${sent} ${key} ${answered}`,
  );
});

test('a test id header the runner did not issue counts as untagged, under its arrival time', async (t) => {
  const server = await startServer(t);
  const outDir = server.run({ perTest: true });
  await server.ask(0, '__proto__');

  const keys = readSnapshotDir(outDir).snapshots.flatMap(({ coverage }) =>
    Object.keys(coverage?.perTest ?? {}),
  );

  assert.equal(keys.length, 1);
  assert.notEqual(untaggedArrival(keys[0] ?? ''), undefined, keys[0]);
});

test('without per-test coverage every hit is static, header or not', async (t) => {
  const server = await startServer(t);
  const outDir = server.run({ perTest: false });
  await server.ask(0, 'small');

  const coverage = coverageOf(outDir);

  assert.deepEqual(Object.keys(coverage.perTest), []);
  assert.deepEqual(appMutantIdsOf(coverage.static), [
    '0',
    '1',
    '2',
    '3',
    '4',
    '5',
    '7',
  ]);
});

test("a run's hit count counts only the active mutant's hits in that run", async (t) => {
  const server = await startServer(t);
  const first = server.run({ perTest: false, activeMutant: '7', hitLimit: 10 });
  await server.ask(0);
  await server.ask(0);
  await server.ask(2);
  const second = server.run({
    perTest: false,
    activeMutant: '7',
    hitLimit: 10,
  });
  await server.ask(0);

  const hits = (outDir: string) =>
    readSnapshotDir(outDir).snapshots.reduce(
      (sum, { hitCount }) => sum + hitCount,
      0,
    );

  assert.equal(hits(first), 2);
  assert.equal(hits(second), 1);
});

test('a run folder that is gone drops the coverage, and the server keeps serving', async (t) => {
  const server = await startServer(t);
  writeServerControl(server.serverDir, {
    outDir: path.join(server.serverDir, 'gone'),
    perTest: true,
  });

  assert.equal(await server.ask(0, 'small'), 'one');
  assert.equal(await server.ask(2, 'big'), 'hi many');
});
