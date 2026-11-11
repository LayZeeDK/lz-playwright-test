import http from 'node:http';

import { answer } from './app.mjs';

const wrapped = [];
const wrapErrors = [];

function wrap(target, key, wrapperOf) {
  ['assigned', 'redefined'].forEach((how) => {
    try {
      const value = wrapperOf(target[key], how);

      if (how === 'assigned') {
        target[key] = value;
      } else {
        Object.defineProperty(target, key, {
          configurable: true,
          writable: true,
          value,
        });
      }
    } catch (error) {
      wrapErrors.push(`${key} ${how}: ${String(error)}`);
    }
  });
}

function passThrough(before) {
  return function (...args) {
    return before.apply(this, args);
  };
}

wrap(
  http.Server.prototype,
  'emit',
  (before, how) =>
    function (event, ...args) {
      if (event === 'request') {
        wrapped.push(how);
      }

      return before.call(this, event, ...args);
    },
);
wrap(http.Agent.prototype, 'addRequest', passThrough);

const server = http.createServer(async (request, response) => {
  const n = Number(new URL(request.url, 'http://x').searchParams.get('n'));
  wrap(response, 'end', passThrough);
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
