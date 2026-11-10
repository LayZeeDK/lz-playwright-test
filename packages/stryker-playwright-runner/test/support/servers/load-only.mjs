import http from 'node:http';

import './app.mjs';

const server = http.createServer((request, response) => {
  response.end('loaded');
});
server.listen(0, '127.0.0.1', () =>
  process.stdout.write(`${server.address().port}\n`),
);
