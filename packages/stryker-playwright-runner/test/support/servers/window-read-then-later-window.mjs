import http from 'node:http';

const server = http.createServer(async (request, response) => {
  queueMicrotask(() => globalThis.__stryker__);
  const ns = globalThis.__stryker__;
  const later = await new Promise((resolve) => {
    queueMicrotask(() => {
      queueMicrotask(() => resolve(ns.currentTestId));
      void globalThis.__stryker__;
    });
  });
  response.end(JSON.stringify([later]));
});
server.listen(0, '127.0.0.1', () =>
  process.stdout.write(`${server.address().port}\n`),
);
