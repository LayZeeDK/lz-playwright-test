import http from 'node:http';

const server = http.createServer(async (request, response) => {
  queueMicrotask(() => globalThis.__stryker_hook_test__);
  const ns = globalThis.__stryker_hook_test__;
  await null;
  response.end(String(ns.currentTestId));
});
server.listen(0, '127.0.0.1', () =>
  process.stdout.write(`${server.address().port}\n`),
);
