import http from 'node:http';

const ns = globalThis.__stryker__;
const waiting = [];
setInterval(
  () => waiting.splice(0).forEach((resolve) => resolve(ns.currentTestId)),
  5,
).unref();

const server = http.createServer(async (request, response) => {
  const outside = await new Promise((resolve) => waiting.push(resolve));
  response.end(String(outside));
});
server.listen(0, '127.0.0.1', () =>
  process.stdout.write(`${server.address().port}\n`),
);
