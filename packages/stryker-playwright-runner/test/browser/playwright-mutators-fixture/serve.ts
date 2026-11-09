import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { text } from 'node:stream/consumers';

let note = '';
let visits = 0;

createServer(async (request, response) => {
  const route = `${request.method} ${request.url}`;

  if (route === 'POST /api/note') {
    note = await text(request);
    response.writeHead(204).end();

    return;
  }

  if (route === 'GET /api/note') {
    response.writeHead(200, { 'content-type': 'text/plain' }).end(note);
    note = '';

    return;
  }

  if (route === 'POST /api/visit') {
    visits += 1;
    response.writeHead(204).end();

    return;
  }

  if (route === 'GET /api/visits') {
    response
      .writeHead(200, { 'content-type': 'text/plain' })
      .end(String(visits));
    visits = 0;

    return;
  }

  try {
    const body = await readFile(
      new URL(
        `./site${request.url === '/' ? '/index.html' : request.url}`,
        import.meta.url,
      ),
    );
    response.writeHead(200, { 'content-type': 'text/html' }).end(body);
  } catch {
    response.writeHead(404).end();
  }
}).listen(4323, '127.0.0.1');
