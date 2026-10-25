// Started as a worker thread by a fixture test. The Stryker hook's install loads playwright-core
// through require, so finding it in this thread's require cache means the hook installed here.
import { createRequire } from 'node:module';
import { isMainThread, parentPort } from 'node:worker_threads';

const { cache } = createRequire(import.meta.url);

parentPort.postMessage({
  argv1: process.argv[1],
  isMainThread,
  hookInstalled: Object.keys(cache).some((file) =>
    /[\\/]playwright-core[\\/]/.test(file),
  ),
});
