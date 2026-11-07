import http from 'node:http';

import { answer } from './app.mjs';

const server = http.createServer(async (request, response) => {
  const n = Number(new URL(request.url, 'http://x').searchParams.get('n'));
  response.end(answer(n));
});
server.listen(0, '127.0.0.1', () =>
  process.stdout.write(`${server.address().port}\n`),
);
