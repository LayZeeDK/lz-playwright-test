import http from 'node:http';

const server = http.createServer(async (request, response) => {
  const ns = globalThis.__stryker_hook_test__;
  const during = ns.currentTestId;
  await null;
  response.end(JSON.stringify([during, ns.currentTestId]));
});
server.listen(0, '127.0.0.1', () =>
  process.stdout.write(`${server.address().port}\n`),
);
