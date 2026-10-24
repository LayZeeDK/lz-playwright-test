import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';

const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript' };

createServer(async (request, response) => {
  const file = new URL(request.url === '/' ? '/index.html' : (request.url ?? '/'), 'http://x').pathname;

  try {
    const body = await readFile(new URL(`./public${file}`, import.meta.url));
    response.writeHead(200, { 'content-type': types[file.slice(file.lastIndexOf('.'))] ?? 'text/plain' });
    response.end(body);
  } catch {
    response.writeHead(404).end();
  }
}).listen(Number(process.env.PORT ?? 4321));
