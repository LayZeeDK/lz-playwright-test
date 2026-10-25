import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';

const types: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
};

const server = createServer(async (request, response) => {
  // Lets a test kill the server between runs.
  if (request.url === '/__exit') {
    response.end();
    server.close();
    server.closeAllConnections();

    return;
  }

  const file = new URL(
    request.url === '/' ? '/index.html' : (request.url ?? '/'),
    'http://x',
  ).pathname;

  try {
    const body = await readFile(new URL(`./public${file}`, import.meta.url));
    response.writeHead(200, {
      'content-type': types[file.slice(file.lastIndexOf('.'))] ?? 'text/plain',
    });
    response.end(body);
  } catch {
    response.writeHead(404).end();
  }
});

server.listen(Number(process.env.PORT ?? 4321), 'localhost');
