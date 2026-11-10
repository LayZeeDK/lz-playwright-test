import http from 'node:http';

const server = http.createServer(async (request, response) => {
  const before = globalThis.__stryker_hook_test__;

  try {
    globalThis.__stryker_hook_test__ = {};
  } catch (error) {
    response.end(String(error));

    return;
  }

  response.end(String(globalThis.__stryker_hook_test__ === before));
});
server.listen(0, '127.0.0.1', () =>
  process.stdout.write(`${server.address().port}\n`),
);
