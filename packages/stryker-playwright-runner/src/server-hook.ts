import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';

import { INSTRUMENTER_CONSTANTS } from '@stryker-mutator/api/core';

import { isRecord } from './is-record.ts';
import { globalNamespace, type StrykerNamespace } from './namespace.ts';
import { serializeSnapshot, snapshotSuffix } from './protocol.ts';
import {
  hookedPrefix,
  readServerControl,
  type ServerControl,
  serverDirEnv,
  serverSnapshotPrefix,
  testIdHeader,
  untaggedKey,
} from './server-protocol.ts';

interface RequestTag {
  readonly testId: string | undefined;
  readonly arrivedAt: number;
}

const serverDir = process.env[serverDirEnv];
// `Symbol.for`, so a second copy of this package in the process leaves the server to the first.
const installed: unique symbol = Symbol.for(
  '@layzee/stryker-playwright-runner/server-hook',
);

if (serverDir !== undefined && !(installed in globalThis)) {
  Reflect.set(globalThis, installed, installed);
  installServerHook(serverDir);
}

/**
 * Switches the active mutant per request from the control file the runner writes before each run, and
 * writes the coverage of each request to that run's folder before its response ends.
 */
export function installServerHook(
  dir: string,
  ns: string = INSTRUMENTER_CONSTANTS.NAMESPACE,
  now: () => number = Date.now,
): void {
  const namespace = globalNamespace(ns);
  const requests = new AsyncLocalStorage<RequestTag>();
  const fileName = `${serverSnapshotPrefix}${process.pid}-${randomUUID()}${snapshotSuffix}`;
  let control: ServerControl | undefined;
  let writtenHits = 0;
  let marked = false;
  let evaluating = false;

  Object.defineProperty(globalThis, ns, {
    configurable: true,
    get: () => {
      if (!evaluating) {
        evaluating = true;
        queueMicrotask(() => {
          evaluating = false;
        });
      }

      return namespace;
    },
    set: () => undefined,
  });

  Object.defineProperty(namespace, 'currentTestId', {
    configurable: true,
    get: () => {
      const tag = requests.getStore();

      if (evaluating || !control?.perTest || tag === undefined) {
        return undefined;
      }

      return tag.testId ?? untaggedKey(tag.arrivedAt);
    },
  });

  function startRequest() {
    const next = readServerControl(dir) ?? control;

    if (next?.outDir !== control?.outDir) {
      namespace.hitLimit = next?.hitLimit;
      namespace.hitCount = next?.hitLimit === undefined ? undefined : 0;
      writtenHits = 0;
    }

    control = next;
    namespace.activeMutant = control?.activeMutant;
  }

  // A throw here would end the server; after the run its folder is gone, so the write is dropped.
  function flush() {
    const outDir = control?.outDir;

    if (outDir === undefined) {
      return;
    }

    const hits =
      typeof namespace.hitCount === 'number' ? namespace.hitCount : 0;
    const coverage = takeCoverage(namespace);

    if (coverage === undefined && hits === writtenHits) {
      return;
    }

    try {
      fs.appendFileSync(
        path.join(outDir, fileName),
        serializeSnapshot({
          mutantCoverage: coverage,
          hitCount: hits - writtenHits,
          outlivedItsTest: false,
        }) + '\n',
      );
    } catch {
      // Dropped, as above.
    }

    writtenHits = hits;
  }

  function markHooked() {
    if (marked) {
      return;
    }

    marked = true;
    fs.writeFileSync(path.join(dir, `${hookedPrefix}${process.pid}`), '');
  }

  [http.Server.prototype, https.Server.prototype].forEach((prototype) => {
    const emit = prototype.emit;
    Object.defineProperty(prototype, 'emit', {
      configurable: true,
      writable: true,
      value: function emitWithStryker(
        this: unknown,
        event: unknown,
        ...args: unknown[]
      ): unknown {
        const [request, response] = args;
        const original = (): unknown =>
          Reflect.apply(emit, this, [event, ...args]);

        if (event === 'listening') {
          markHooked();
        }

        if (
          event !== 'request' ||
          !(request instanceof http.IncomingMessage) ||
          !(response instanceof http.ServerResponse)
        ) {
          return original();
        }

        startRequest();
        flushBeforeEnd(response, flush);
        const header = request.headers[testIdHeader];

        return requests.run(
          {
            testId: typeof header === 'string' ? header : undefined,
            arrivedAt: now(),
          },
          original,
        );
      },
    });
  });

  process.on('exit', flush);
}

// Before end, not on 'finish': the client may have the response, and the runner may read the run's folder,
// before 'finish' fires.
function flushBeforeEnd(response: object, flush: () => void) {
  const end: unknown = Reflect.get(response, 'end');

  if (typeof end !== 'function') {
    return;
  }

  Object.defineProperty(response, 'end', {
    configurable: true,
    writable: true,
    value: (...args: unknown[]): unknown => {
      flush();

      return Reflect.apply(end, response, args);
    },
  });
}

/** Copies the coverage and empties it in place: instrumented code holds the object it first created. */
function takeCoverage(namespace: StrykerNamespace): unknown {
  const coverage = namespace.mutantCoverage;

  if (
    !isRecord(coverage) ||
    !isRecord(coverage['static']) ||
    !isRecord(coverage['perTest'])
  ) {
    return undefined;
  }

  const { static: hits, perTest } = coverage;

  if (Object.keys(hits).length === 0 && Object.keys(perTest).length === 0) {
    return undefined;
  }

  const copy = structuredClone(coverage);
  Object.keys(hits).forEach((key) => {
    delete hits[key];
  });
  Object.keys(perTest).forEach((key) => {
    delete perTest[key];
  });

  return copy;
}
