import http from 'node:http';

import { answer } from './app.mjs';

const wrapped = [];
const wrapErrors = [];

function wrapEmit(how, install) {
  try {
    const before = http.Server.prototype.emit;
    const wrapper = function (event, ...args) {
      if (event === 'request') {
        wrapped.push(how);
      }

      return before.call(this, event, ...args);
    };
    install(wrapper);
  } catch (error) {
    wrapErrors.push(String(error));
  }
}

wrapEmit('assigned', (wrapper) => {
  http.Server.prototype.emit = wrapper;
});
wrapEmit('redefined', (wrapper) => {
  Object.defineProperty(http.Server.prototype, 'emit', {
    configurable: true,
    writable: true,
    value: wrapper,
  });
});

const server = http.createServer(async (request, response) => {
  const n = Number(new URL(request.url, 'http://x').searchParams.get('n'));
  response.end(
    JSON.stringify({
      answer: answer(n),
      wrapped: wrapped.splice(0),
      wrapErrors,
    }),
  );
});
server.listen(0, '127.0.0.1', () =>
  process.stdout.write(`${server.address().port}\n`),
);
