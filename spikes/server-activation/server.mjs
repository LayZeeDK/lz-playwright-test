// Spike server: GET /total?mugs=&posters= answers with the instrumented total(). It waits a random few
// milliseconds first, so requests from different tests interleave.
import http from 'node:http';

import { total } from './out/total.js';

const port = Number(process.env['PORT'] ?? 4810);

http
  .createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    await new Promise((resolve) => setTimeout(resolve, Math.random() * 20));
    const value = total(Number(url.searchParams.get('mugs')), Number(url.searchParams.get('posters')));
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ total: value }));
  })
  .listen(port, () => console.log(`listening on ${port}`));
