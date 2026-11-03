// Spike: loaded into the server with NODE_OPTIONS=--import. Switches Stryker's active mutant per request from a
// control file, attributes coverage to the test named in a request header, and serves the coverage on a private path.
import { AsyncLocalStorage } from 'node:async_hooks';
import fs from 'node:fs';
import http from 'node:http';

const controlFile = process.env['LZ_SPIKE_CONTROL'];
const testHeader = 'x-lz-stryker-test';
const coveragePath = '/__lz_stryker__/coverage';
const ns = (globalThis.__stryker__ ??= {});
const requestTest = new AsyncLocalStorage();

// stryCov reads ns.currentTestId on every hit, so each request's hits land under its own test id.
Object.defineProperty(ns, 'currentTestId', {
  get: () => requestTest.getStore(),
  configurable: true,
});

let cached;

function readControl() {
  const stat = fs.statSync(controlFile, { throwIfNoEntry: false });

  if (stat === undefined) {
    return {};
  }

  if (cached?.mtimeMs !== stat.mtimeMs || cached?.size !== stat.size) {
    cached = { mtimeMs: stat.mtimeMs, size: stat.size, value: JSON.parse(fs.readFileSync(controlFile, 'utf8')) };
  }

  return cached.value;
}

function takeCoverage() {
  // stryCov caches this object on its first hit, so it is emptied in place, never replaced.
  const coverage = ns.mutantCoverage ?? { static: {}, perTest: {} };
  const copy = structuredClone(coverage);

  for (const key of Object.keys(coverage.static)) {
    delete coverage.static[key];
  }

  for (const key of Object.keys(coverage.perTest)) {
    delete coverage.perTest[key];
  }

  return copy;
}

const emit = http.Server.prototype.emit;

http.Server.prototype.emit = function (event, ...args) {
  if (event !== 'request') {
    return emit.call(this, event, ...args);
  }

  const [request, response] = args;

  if (request.url === coveragePath) {
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify(takeCoverage()));

    return true;
  }

  ns.activeMutant = readControl().activeMutant;
  const testId = request.headers[testHeader];

  return requestTest.run(typeof testId === 'string' ? testId : undefined, () =>
    emit.call(this, event, ...args),
  );
};
