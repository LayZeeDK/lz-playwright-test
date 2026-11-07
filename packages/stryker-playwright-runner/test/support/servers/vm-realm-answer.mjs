import { readFileSync } from 'node:fs';
import http from 'node:http';
import vm from 'node:vm';

const realm = vm.createContext({ process: { env: { ...process.env } } });
const app = readFileSync(new URL('./app.mjs', import.meta.url), 'utf8');
vm.runInContext(app.replace('export function', 'function'), realm);
const realmAnswer = vm.runInContext('answer', realm);

const server = http.createServer(async (request, response) => {
  const n = Number(new URL(request.url, 'http://x').searchParams.get('n'));
  response.end(realmAnswer(n));
});
server.listen(0, '127.0.0.1', () =>
  process.stdout.write(`${server.address().port}\n`),
);
