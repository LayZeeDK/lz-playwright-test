import http from 'node:http';

import { answer } from './app.mjs';

const server = http.createServer(async (request, response) => {
  response.end(answer(0));
  setTimeout(() => {
    answer(2);
    process.exit(0);
  }, 50);
});
server.listen(0, '127.0.0.1', () =>
  process.stdout.write(`${server.address().port}\n`),
);
