import assert from 'node:assert/strict';
import { once } from 'node:events';
import net from 'node:net';
import { before, test } from 'node:test';

import { untaggedArrival } from '../src/server-protocol.ts';
import {
  bigRequestIds,
  coverageOf,
  instrumentApp,
  moduleScopeAndBigRequestIds,
  mutantIdsOf,
  perTestKeysOf,
  smallRequestIds,
  startHeaderEcho,
  startServer,
} from './support/hooked-server.ts';

const server = 'self-request';

async function canListenOn(host: string): Promise<boolean> {
  const probe = net.createServer().listen(0, host);

  try {
    await once(probe, 'listening');
    probe.close();

    return true;
  } catch {
    return false;
  }
}

const ipv6Loopback = await canListenOn('::1');

before(instrumentApp);

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
    const selfRequesting = await startServer(t, { server });
    const securePort = await selfRequesting.ask({ n: 0, via: 'secure-port' });
    const outDir = selfRequesting.run({
      perTest: true,
      testIdHosts: [
        `localhost:${selfRequesting.port}`,
        `localhost:${securePort}`,
      ],
    });

    assert.equal(
      await selfRequesting.ask({
        n: 2,
        testId: 'big',
        via: client,
        query: { scheme },
      }),
      'hi many',
    );
    assert.deepEqual(
      mutantIdsOf(coverageOf(outDir).perTest['big']),
      bigRequestIds,
    );
  });
});

[
  { client: 'fetch-own-header', how: 'fetch' },
  {
    client: 'fetch-own-header-after-another',
    how: 'fetch after another header',
  },
  { client: 'http-get-own-header', how: 'http.get' },
].forEach(({ client, how }) => {
  test(`a test id header the server sets on a request to itself with ${how} is kept`, async (t) => {
    const selfRequesting = await startServer(t, { server });
    const outDir = selfRequesting.run({ perTest: true });

    assert.equal(
      await selfRequesting.ask({ n: 2, testId: 'big', via: client }),
      'hi many',
    );

    const coverage = coverageOf(outDir);

    assert.deepEqual(mutantIdsOf(coverage.perTest['small']), bigRequestIds);
    assert.deepEqual(mutantIdsOf(coverage.perTest['big']), []);
  });
});

[
  { why: 'without a test id header', testId: undefined },
  { why: 'with a test id the runner did not issue', testId: '__proto__' },
].forEach(({ why, testId }) => {
  test(`a request the server sends itself for a request ${why} names no test`, async (t) => {
    const selfRequesting = await startServer(t, { server });
    const outDir = selfRequesting.run({ perTest: true });

    assert.equal(
      await selfRequesting.ask({ n: 2, testId, via: 'fetch-string' }),
      'hi many',
    );

    const keys = perTestKeysOf(outDir);

    assert.ok(keys.length > 0);
    assert.ok(
      keys.every((key) => untaggedArrival(key) !== undefined),
      keys.join(),
    );
  });
});

test('requests two tests make at once each send their own test id to the server itself', async (t) => {
  const selfRequesting = await startServer(t, { server });
  const outDir = selfRequesting.run({ perTest: true });

  await Promise.all([
    selfRequesting.ask({ n: 2, testId: 'big', via: 'fetch-string' }),
    selfRequesting.ask({ n: 0, testId: 'small', via: 'http-get-url' }),
    selfRequesting.ask({ n: 2, testId: 'big', via: 'http-get-url' }),
    selfRequesting.ask({ n: 0, testId: 'small', via: 'fetch-string' }),
  ]);

  const coverage = coverageOf(outDir);

  assert.deepEqual(mutantIdsOf(coverage.perTest['big']), bigRequestIds);
  assert.deepEqual(mutantIdsOf(coverage.perTest['small']), smallRequestIds);
});

test('without per-test coverage a request the server sends itself is static', async (t) => {
  const selfRequesting = await startServer(t, { server });
  const outDir = selfRequesting.run({ perTest: false });

  assert.equal(
    await selfRequesting.ask({ n: 2, testId: 'big', via: 'fetch-string' }),
    'hi many',
  );

  const coverage = coverageOf(outDir);

  assert.deepEqual(Object.keys(coverage.perTest), []);
  assert.deepEqual(mutantIdsOf(coverage.static), moduleScopeAndBigRequestIds);
});

test('a request the server sends itself after the response ended still counts under the test of the request that started it', async (t) => {
  const selfRequesting = await startServer(t, { server });
  const outDir = selfRequesting.run({ perTest: true });

  assert.equal(
    await selfRequesting.ask({ n: 2, testId: 'big', via: 'late' }),
    'sent later',
  );
  assert.equal(
    await selfRequesting.ask({ n: 0, via: 'late-answer' }),
    'hi many',
  );
  assert.deepEqual(
    mutantIdsOf(coverageOf(outDir).perTest['big']),
    bigRequestIds,
  );
});

test('a test id header the server forwards to a second hooked server counts there under the same test', async (t) => {
  const second = await startServer(t);
  const secondOutDir = second.run({ perTest: true });
  const first = await startServer(t, { server });
  first.run({ perTest: true });

  assert.equal(
    await first.ask({
      n: 2,
      testId: 'big',
      via: 'fetch-forward',
      query: { port: String(second.port) },
    }),
    'hi many',
  );
  assert.deepEqual(
    mutantIdsOf(coverageOf(secondOutDir).perTest['big']),
    bigRequestIds,
  );
});

test('a request to a host name a URL cannot hold fails as it would without the hook', async (t) => {
  const selfRequesting = await startServer(t, { server });
  selfRequesting.run({ perTest: true });

  assert.equal(
    await selfRequesting.ask({ n: 2, testId: 'big', via: 'http-get-bad-host' }),
    'other',
  );
});

test('a request the server sends itself with raw array headers still goes out, without the test id', async (t) => {
  const selfRequesting = await startServer(t, { server });
  const outDir = selfRequesting.run({ perTest: true });

  assert.equal(
    await selfRequesting.ask({
      n: 2,
      testId: 'big',
      via: 'http-request-array-headers',
    }),
    'hi many',
  );
  assert.deepEqual(mutantIdsOf(coverageOf(outDir).perTest['big']), []);
});

test('a request the server sends itself with fetch and the test id header name as another header value still names the test', async (t) => {
  const selfRequesting = await startServer(t, { server });
  const outDir = selfRequesting.run({ perTest: true });

  assert.equal(
    await selfRequesting.ask({
      n: 2,
      testId: 'big',
      via: 'fetch-header-named-in-a-value',
    }),
    'hi many',
  );
  assert.deepEqual(
    mutantIdsOf(coverageOf(outDir).perTest['big']),
    bigRequestIds,
  );
});

test("messages without a request object on undici's request channel leave the server answering, and its next fetch still names the test", async (t) => {
  const selfRequesting = await startServer(t, { server });
  const outDir = selfRequesting.run({ perTest: true });

  assert.equal(
    await selfRequesting.ask({
      n: 2,
      testId: 'big',
      via: 'fetch-after-odd-undici-messages',
    }),
    'hi many',
  );
  assert.deepEqual(
    mutantIdsOf(coverageOf(outDir).perTest['big']),
    bigRequestIds,
  );
});

test(
  'a request the server sends with http.get to an IPv6 loopback host of the run carries the test id',
  {
    skip: ipv6Loopback ? false : '::1 is not available',
  },
  async (t) => {
    const echoPort = await startHeaderEcho(t, '::1');
    const selfRequesting = await startServer(t, { server });
    selfRequesting.run({
      perTest: true,
      testIdHosts: [`localhost:${echoPort}`],
    });

    assert.equal(
      await selfRequesting.ask({
        n: 2,
        testId: 'big',
        via: 'http-get-url',
        query: { host: '[::1]', port: String(echoPort) },
      }),
      'big',
    );
  },
);

test('a request the server sends to another host gets no test id header', async (t) => {
  const otherPort = await startHeaderEcho(t);
  const selfRequesting = await startServer(t, { server });
  selfRequesting.run({ perTest: true });

  assert.equal(
    await selfRequesting.ask({
      n: 2,
      testId: 'big',
      via: 'fetch-string',
      query: { port: String(otherPort) },
    }),
    'undefined',
  );
});

test("a request the server sends to another port with the server's own Host header gets no test id header", async (t) => {
  const otherPort = await startHeaderEcho(t);
  const selfRequesting = await startServer(t, { server });
  selfRequesting.run({ perTest: true });

  assert.equal(
    await selfRequesting.ask({
      n: 2,
      testId: 'big',
      via: 'http-get-own-host',
      query: { port: String(otherPort) },
    }),
    'undefined',
  );
});

test('a redirect from the server to another host carries no test id header', async (t) => {
  const otherPort = await startHeaderEcho(t);
  const selfRequesting = await startServer(t, { server });
  selfRequesting.run({ perTest: true });

  assert.equal(
    await selfRequesting.ask({
      n: 2,
      testId: 'big',
      via: 'fetch-string',
      query: { then: 'redirect', to: String(otherPort) },
    }),
    'undefined',
  );
});
