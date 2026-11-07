import { readFileSync } from 'node:fs';
import http, { get as namedGet } from 'node:http';
import https from 'node:https';

import { answer } from './app.mjs';

const testIdHeader = 'x-lz-stryker-test';
const tls = {
  key: readFileSync(new URL('./tls/localhost-key.pem', import.meta.url)),
  cert: readFileSync(new URL('./tls/localhost-cert.pem', import.meta.url)),
};
const secure = https.createServer(tls, (request, response) => {
  response.end(
    answer(Number(new URL(request.url, 'http://x').searchParams.get('n'))),
  );
});
secure.listen(0, '127.0.0.1');
const ca = tls.cert;
const optionsOf = (url) => {
  const { hostname, port, pathname, search } = new URL(url);

  return { hostname, port, path: pathname + search, ca };
};
const sent = (request) => {
  request.end();

  return request;
};
const textOf = (request) =>
  new Promise((resolve, reject) => {
    request.on('error', reject);
    request.on('response', (response) => {
      response.setEncoding('utf8');
      let body = '';
      response.on('data', (chunk) => (body += chunk));
      response.on('end', () => resolve(body));
    });
  });
const clients = {
  'fetch-string': async (url) => (await fetch(url)).text(),
  'http-get-url': (url) => textOf(http.get(new URL(url))),
  'fetch-url': async (url) => (await fetch(new URL(url))).text(),
  'fetch-request': async (url) => (await fetch(new Request(url))).text(),
  'http-get-options': (url) => textOf(http.get(optionsOf(url))),
  'http-get-named-import': (url) => textOf(namedGet(url)),
  'http-request-url': (url) => textOf(sent(http.request(new URL(url)))),
  'http-request-options': (url) => textOf(sent(http.request(optionsOf(url)))),
  'https-get-url': (url) => textOf(https.get(new URL(url), { ca })),
  'https-request-options': (url) => textOf(sent(https.request(optionsOf(url)))),
  'fetch-own-header': async (url) =>
    (await fetch(url, { headers: { [testIdHeader]: 'small' } })).text(),
  'fetch-own-header-after-another': async (url) =>
    (
      await fetch(url, {
        headers: [
          ['x-other', 'other'],
          [testIdHeader, 'small'],
        ],
      })
    ).text(),
  'fetch-header-named-in-a-value': async (url) =>
    (await fetch(url, { headers: { 'x-other': testIdHeader } })).text(),
  'http-get-own-header': (url) =>
    textOf(http.get(url, { headers: { [testIdHeader]: 'small' } })),
  'http-get-own-host': (url) =>
    textOf(
      http.get(url, {
        headers: { host: `127.0.0.1:${server.address().port}` },
      }),
    ),
  'fetch-forward': async (url, incoming) =>
    (
      await fetch(url, {
        headers: { [testIdHeader]: incoming.headers[testIdHeader] },
      })
    ).text(),
  'http-get-bad-host': async () => {
    const kind = (error) =>
      error instanceof TypeError ? 'TypeError' : 'other';

    try {
      return await textOf(http.get({ hostname: 'a b', port: 1 })).then(
        () => 'answered',
        kind,
      );
    } catch (error) {
      return kind(error);
    }
  },
  'http-request-array-headers': (url) =>
    textOf(sent(http.request(url, { headers: ['host', new URL(url).host] }))),
};

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, 'http://x');

  if (url.pathname === '/redirect') {
    response.writeHead(302, {
      location: `http://127.0.0.1:${url.searchParams.get('to')}/`,
    });
    response.end();

    return;
  }

  if (url.pathname === '/late') {
    const self = `http://127.0.0.1:${server.address().port}/?n=${url.searchParams.get('n')}`;
    globalThis.late = new Promise((resolve) => setTimeout(resolve, 20))
      .then(() => fetch(self))
      .then((answer) => answer.text());
    response.end('sent later');

    return;
  }

  if (url.pathname === '/late-answer') {
    response.end(await globalThis.late);

    return;
  }

  if (url.pathname === '/secure-port') {
    response.end(String(secure.address().port));

    return;
  }

  if (url.pathname !== '/') {
    const scheme = url.searchParams.get('scheme') ?? 'http';
    const port =
      url.searchParams.get('port') ??
      (scheme === 'https' ? secure : server).address().port;
    const host = url.searchParams.get('host') ?? '127.0.0.1';
    const self = `${scheme}://${host}:${port}/${url.searchParams.get('then') ?? ''}?${url.searchParams}`;
    response.end(await clients[url.pathname.slice(1)](self, request));

    return;
  }

  const n = Number(new URL(request.url, 'http://x').searchParams.get('n'));
  response.end(answer(n));
});
server.listen(0, '127.0.0.1', () =>
  process.stdout.write(`${server.address().port}\n`),
);
