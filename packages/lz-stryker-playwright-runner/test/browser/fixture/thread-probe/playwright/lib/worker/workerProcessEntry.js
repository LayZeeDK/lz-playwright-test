// Started as a worker thread by a fixture test. The Stryker hook's install loads playwright-core
// through require, so finding it in this thread's require cache means the hook installed here.
// The file sits at a path that ends like Playwright's worker entry, so the hook's argv[1] check
// passes in this thread and only its isMainThread check keeps the hook out.
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
