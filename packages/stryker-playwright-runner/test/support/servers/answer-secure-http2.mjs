import { readFileSync } from 'node:fs';
import http2 from 'node:http2';

import { answer } from './app.mjs';

const server = http2.createSecureServer(
  {
    allowHTTP1: process.argv.includes('--allow-http1'),
    key: readFileSync(new URL('./tls/localhost-key.pem', import.meta.url)),
    cert: readFileSync(new URL('./tls/localhost-cert.pem', import.meta.url)),
  },
  async (request, response) => {
    const n = Number(new URL(request.url, 'http://x').searchParams.get('n'));
    response.end(answer(n));
  },
);
server.listen(0, '127.0.0.1', () =>
  process.stdout.write(`${server.address().port}\n`),
);
