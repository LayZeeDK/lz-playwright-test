// Serves this folder for the trace-media spike. Usage: node server.mjs <port>
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'));
const types = { '.html': 'text/html', '.webm': 'video/webm' };

createServer(async (request, response) => {
  const name = new URL(request.url, 'http://x').pathname.slice(1) || 'page.html';
  try {
    const body = await readFile(path.join(root, path.basename(name)));
    response.writeHead(200, { 'content-type': types[path.extname(name)] ?? 'application/octet-stream' });
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end();
  }
}).listen(Number(process.argv[2]), '127.0.0.1');
