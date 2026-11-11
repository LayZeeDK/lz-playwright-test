import { once } from 'node:events';
import http from 'node:http';

const server = http.createServer(async (request, response) => {
  const later = http.createServer();
  later.listen(0, '127.0.0.1');
  await once(later, 'listening');
  later.close();
  response.end('listened again');
});
server.listen(0, '127.0.0.1', () =>
  process.stdout.write(`${server.address().port}\n`),
);
