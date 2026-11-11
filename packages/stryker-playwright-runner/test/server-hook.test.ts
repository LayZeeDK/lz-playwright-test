import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readdirSync, readFileSync } from 'node:fs';
import http from 'node:http';
import http2 from 'node:http2';
import https from 'node:https';
import path from 'node:path';
import { before, test } from 'node:test';

import { readSnapshotDir } from '../src/protocol.ts';
import {
  anyHooked,
  serverSnapshotPrefix,
  testIdHeader,
  untaggedArrival,
  writeServerControl,
} from '../src/server-protocol.ts';
import {
  hookTestActiveMutantEnv,
  withoutPrototypes,
} from './support/doubles.ts';
import {
  bigRequestIds,
  coverageOf,
  instrumentApp,
  moduleScopeAndBigRequestIds,
  moduleScopeAndSmallRequestIds,
  mutantIdsOf,
  perTestKeysOf,
  smallRequestIds,
  startHeaderEcho,
  startServer,
  tlsCertPath,
} from './support/hooked-server.ts';
import { serverHookUrl } from './support/server-fake.ts';

before(instrumentApp);

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

test('the hook marks its server hooked once it listens', async (t) => {
  const server = await startServer(t);

  assert.equal(anyHooked(server.serverDir), true);
});

test('the active mutant switches per request from the control file, without a restart', async (t) => {
  const server = await startServer(t);

  assert.equal(await server.ask({ n: 0 }), 'one', 'no control file yet');

  server.run({ perTest: false, activeMutant: '2' });

  assert.equal(await server.ask({ n: 0 }), 'hi many');

  server.run({ perTest: false, activeMutant: '7' });

  assert.equal(await server.ask({ n: 0 }), '');
  assert.equal(await server.ask({ n: 2 }), 'hi many');

  server.run({ perTest: false });

  assert.equal(await server.ask({ n: 0 }), 'one');
});

test('an http2 server switches the active mutant per request too', async (t) => {
  const server = await startServer(t, { server: 'answer-http2' });
  server.run({ perTest: false, activeMutant: '2' });

  assert.equal(await askHttp2(`http://127.0.0.1:${server.port}`, 0), 'hi many');
});

test('an http2 server is marked hooked once it listens', async (t) => {
  const server = await startServer(t, { server: 'answer-http2' });

  assert.equal(anyHooked(server.serverDir), true);
});

test('an http2 server collects coverage per test id header', async (t) => {
  const server = await startServer(t, { server: 'answer-http2' });
  const outDir = server.run({ perTest: true });
  await askHttp2(
    `http://127.0.0.1:${server.port}`,
    2,
    {},
    { [testIdHeader]: 'big' },
  );

  assert.deepEqual(
    mutantIdsOf(coverageOf(outDir).perTest['big']),
    bigRequestIds,
  );
});

test('a secure http2 server switches the active mutant per request too', async (t) => {
  const server = await startServer(t, { server: 'answer-secure-http2' });
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
    server: 'answer-secure-http2',
    args: ['--allow-http1'],
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

test("a server that answers 'Expect: 100-continue' itself switches the active mutant per request too", async (t) => {
  const server = await startServer(t, { server: 'answer-continue' });
  server.run({ perTest: false, activeMutant: '2' });
  const request = http.request(`http://127.0.0.1:${server.port}/?n=0`, {
    method: 'POST',
    headers: { expect: '100-continue' },
  });
  request.on('continue', () => request.end());
  const responded: unknown[] = await once(request, 'response');
  const [response] = responded;
  assert.ok(response instanceof http.IncomingMessage);
  response.setEncoding('utf8');

  assert.equal((await response.toArray()).join(''), 'hi many');
});

test("instrumentation that wraps emit, an agent's addRequest or a response's end after the hook, by assignment and by redefining it, wraps them, and the mutant still switches", async (t) => {
  const server = await startServer(t, { server: 'wrapped-after-hook' });
  server.run({ perTest: false, activeMutant: '2' });

  assert.deepEqual(JSON.parse(await server.ask({ n: 0 })), {
    answer: 'hi many',
    wrapped: ['redefined', 'assigned'],
    wrapErrors: [],
  });
});

test('a server that fails to listen is not marked hooked', async (t) => {
  const takenPort = await startHeaderEcho(t);
  const server = await startServer(t, {
    server: 'fails-to-listen',
    args: [String(takenPort)],
  });

  assert.equal(anyHooked(server.serverDir), false);
});

test('a mutant run once at module scope is active only in a server started with it', async (t) => {
  const switched = await startServer(t);
  switched.run({ perTest: false, activeMutant: '0' });

  assert.equal(await switched.ask({ n: 2 }), 'hi many');

  const started = await startServer(t, {
    env: { [hookTestActiveMutantEnv]: '0' },
  });
  started.run({ perTest: false, activeMutant: '0' });

  assert.equal(await started.ask({ n: 2 }), ' many');
});

test('code the server runs in a vm realm reports no coverage and gets only the mutant the server started with', async (t) => {
  const switched = await startServer(t, { server: 'vm-realm-answer' });
  const dryRun = switched.run({ perTest: true });

  assert.equal(await switched.ask({ n: 2, testId: 'big' }), 'hi many');
  assert.deepEqual(readSnapshotDir(dryRun).snapshots, []);

  switched.run({ perTest: false, activeMutant: '2' });

  assert.equal(await switched.ask({ n: 0 }), 'one', 'no per-request mutant');

  const started = await startServer(t, {
    server: 'vm-realm-answer',
    env: { [hookTestActiveMutantEnv]: '2' },
  });
  started.run({ perTest: false });

  assert.equal(
    await started.ask({ n: 0 }),
    'hi many',
    'the env copy carries it',
  );
});

test('coverage goes to the run folder per test id header, with what ran before the first run as static', async (t) => {
  const server = await startServer(t);
  await server.ask({ n: 2, testId: 'before-any-run' });
  const first = server.run({ perTest: true });
  await Promise.all([
    server.ask({ n: 2, testId: 'big' }),
    server.ask({ n: 0, testId: 'small' }),
  ]);
  const second = server.run({ perTest: true });
  await server.ask({ n: 0, testId: 'small' });

  const coverage = coverageOf(first);

  assert.ok(
    readdirSync(first).every((file) => file.startsWith(serverSnapshotPrefix)),
  );
  assert.deepEqual(
    mutantIdsOf(coverage.static),
    moduleScopeAndBigRequestIds,
    'module scope, and a request before any run, such as a readiness check',
  );
  assert.deepEqual(mutantIdsOf(coverage.perTest['big']), bigRequestIds);
  assert.deepEqual(mutantIdsOf(coverage.perTest['small']), smallRequestIds);
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

test('a run whose requests reach no mutant still hears that the server loaded instrumented code', async (t) => {
  const server = await startServer(t, { server: 'load-only' });
  server.run({ perTest: true });
  await server.ask({ n: 0 });
  const second = server.run({ perTest: true });
  await server.ask({ n: 0 });

  assert.deepEqual(
    readSnapshotDir(second).snapshots.map(({ coverage, instrumented }) => ({
      coverage,
      instrumented,
    })),
    [{ coverage: undefined, instrumented: true }],
  );
});

test('a server that reads the namespace without instrumented code tells the run nothing', async (t) => {
  const server = await startServer(t, { server: 'outside-any-request' });
  const outDir = server.run({ perTest: true });
  await server.ask({ n: 0 });

  assert.deepEqual(readSnapshotDir(outDir).snapshots, []);
});

test('hits a request makes after its response ended reach the run folder when the server exits', async (t) => {
  const server = await startServer(t, { server: 'answer-then-exit' });
  const outDir = server.run({ perTest: true });
  await server.ask({ n: 0, testId: 'small' });
  await server.exited;

  assert.deepEqual(mutantIdsOf(coverageOf(outDir).perTest['small']), [
    '1',
    '2',
    '3',
    '4',
    '5',
    '6',
    '7',
  ]);
});

test("module scope evaluated lazily inside a request is static, and the rest of that request is its test's", async (t) => {
  const server = await startServer(t, { server: 'lazy-answer' });
  const outDir = server.run({ perTest: true });
  await server.ask({ n: 2, testId: 'big' });

  const coverage = coverageOf(outDir);

  assert.deepEqual(mutantIdsOf(coverage.static), ['0']);
  assert.deepEqual(mutantIdsOf(coverage.perTest['big']), bigRequestIds);
});

test('hits count as static only until the microtask after the first read of the namespace global', async (t) => {
  const server = await startServer(t, { server: 'window-first-read' });
  server.run({ perTest: true });

  assert.equal(await server.ask({ n: 0, testId: 'small' }), '[null,"small"]');
});

test('a read of the namespace global inside an open window does not keep it open', async (t) => {
  const server = await startServer(t, { server: 'window-read-while-open' });
  server.run({ perTest: true });

  assert.equal(await server.ask({ n: 0, testId: 'small' }), 'small');
});

test('a read of the namespace global inside an open window schedules no close that ends a later window early', async (t) => {
  const server = await startServer(t, {
    server: 'window-read-then-later-window',
  });
  server.run({ perTest: true });

  assert.equal(await server.ask({ n: 0, testId: 'small' }), '[null]');
});

test('code that runs outside any request names no test', async (t) => {
  const server = await startServer(t, { server: 'outside-any-request' });
  server.run({ perTest: true });

  assert.equal(await server.ask({ n: 0, testId: 'small' }), 'undefined');
});

test('a second copy of the hook leaves lazily evaluated module scope static', async (t) => {
  const server = await startServer(t, {
    server: 'lazy-answer',
    hooks: [serverHookUrl, `${serverHookUrl}?copy`],
  });
  const outDir = server.run({ perTest: true });
  await server.ask({ n: 2, testId: 'big' });

  const coverage = coverageOf(outDir);

  assert.deepEqual(mutantIdsOf(coverage.static), ['0']);
  assert.deepEqual(mutantIdsOf(coverage.perTest['big']), bigRequestIds);
});

test('without per-test coverage lazily evaluated module scope and the request are static', async (t) => {
  const server = await startServer(t, { server: 'lazy-answer' });
  const outDir = server.run({ perTest: false });
  await server.ask({ n: 2, testId: 'big' });

  const coverage = coverageOf(outDir);

  assert.deepEqual(Object.keys(coverage.perTest), []);
  assert.deepEqual(mutantIdsOf(coverage.static), moduleScopeAndBigRequestIds);
});

test('assigning the namespace global is ignored, not a throw', async (t) => {
  const server = await startServer(t, { server: 'assign-namespace' });

  assert.equal(await server.ask({ n: 0 }), 'true');
});

test('a request without the header counts under its arrival time', async (t) => {
  const server = await startServer(t);
  await server.ask({ n: 2 });
  const outDir = server.run({ perTest: true });
  const sent = Date.now();
  await server.ask({ n: 0 });
  const answered = Date.now();

  const keys = perTestKeysOf(outDir);

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
  await server.ask({ n: 0, testId: '__proto__' });

  const keys = perTestKeysOf(outDir);

  assert.equal(keys.length, 1);
  assert.notEqual(untaggedArrival(keys[0] ?? ''), undefined, keys[0]);
});

test('without per-test coverage every hit is static, header or not', async (t) => {
  const server = await startServer(t);
  const outDir = server.run({ perTest: false });
  await server.ask({ n: 0, testId: 'small' });

  const coverage = coverageOf(outDir);

  assert.deepEqual(Object.keys(coverage.perTest), []);
  assert.deepEqual(mutantIdsOf(coverage.static), moduleScopeAndSmallRequestIds);
});

test("a run's hit count counts only the active mutant's hits in that run", async (t) => {
  const server = await startServer(t);
  const first = server.run({ perTest: false, activeMutant: '7', hitLimit: 10 });
  await server.ask({ n: 0 });
  await server.ask({ n: 0 });
  await server.ask({ n: 2 });
  const second = server.run({
    perTest: false,
    activeMutant: '7',
    hitLimit: 10,
  });
  await server.ask({ n: 0 });

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

  assert.equal(await server.ask({ n: 0, testId: 'small' }), 'one');
  assert.equal(await server.ask({ n: 2, testId: 'big' }), 'hi many');
});
