import http from 'node:http';

const server = http.createServer(async (request, response) => {
  const before = globalThis.__stryker__;

  try {
    globalThis.__stryker__ = {};
  } catch (error) {
    response.end(String(error));

    return;
  }

  response.end(String(globalThis.__stryker__ === before));
});
server.listen(0, '127.0.0.1', () =>
  process.stdout.write(`${server.address().port}\n`),
);
