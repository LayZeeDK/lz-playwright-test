import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, readFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { TestContext } from 'node:test';
import { setTimeout } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { INSTRUMENTER_CONSTANTS } from '@stryker-mutator/api/core';
import { Instrumenter } from '@stryker-mutator/instrumenter';

import { hookTestNamespaceEnv, readSnapshotDir } from '../../src/protocol.ts';
import { mergeCoverage } from '../../src/run-result.ts';
import {
  type ServerControl,
  serverDirEnv,
  testIdHeader,
  writeServerControl,
} from '../../src/server-protocol.ts';
import {
  hookTestActiveMutantEnv,
  hookTestNamespace,
  logger,
  tempTree,
} from './doubles.ts';
import { serverHookUrl } from './server-fake.ts';

export const tlsCertPath = fileURLToPath(
  new URL('tls/localhost-cert.pem', import.meta.url),
);
const tlsKeyPath = fileURLToPath(
  new URL('tls/localhost-key.pem', import.meta.url),
);
// Mutant ids the instrumenter gives this source: 0 is 'hi', run once at module scope; 2 makes the condition
// true; 6 empties ' many'; 7 empties 'one'.
const source = [
  "const greeting = 'hi';",
  'export function answer(n) {',
  "  return n > 1 ? greeting + ' many' : 'one';",
  '}',
  '',
].join('\n');
export const bigRequestIds = ['1', '2', '3', '4', '5', '6'];
export const smallRequestIds = ['1', '2', '3', '4', '5', '7'];
export const moduleScopeAndBigRequestIds = ['0', ...bigRequestIds];
export const moduleScopeAndSmallRequestIds = ['0', ...smallRequestIds];
const testIdsTheseTestsSend = ['big', 'small'];
const stopTimeoutMs = 5000;

type ServerProgram =
  | 'answer'
  | 'answer-continue'
  | 'answer-http2'
  | 'answer-secure-http2'
  | 'answer-then-exit'
  | 'assign-namespace'
  | 'fails-to-listen'
  | 'lazy-answer'
  | 'load-only'
  | 'outside-any-request'
  | 'self-request'
  | 'vm-realm-answer'
  | 'window-first-read'
  | 'window-read-then-later-window'
  | 'window-read-while-open'
  | 'wrapped-emit';
let instrumented = '';

export async function instrumentApp() {
  const result = await new Instrumenter(logger().log).instrument(
    [{ name: 'app.mjs', content: source, mutate: true }],
    { plugins: null, excludedMutations: [], ignorers: [] },
  );
  const [file] = result.files;
  assert.ok(file);
  assert.deepEqual(
    result.mutants.map(({ id, replacement }) => `${id} ${replacement}`),
    [
      '0 ""',
      '1 {}',
      '2 true',
      '3 false',
      '4 n >= 1',
      '5 n <= 1',
      '6 ""',
      '7 ""',
    ],
  );
  instrumented = file.content
    .replaceAll(INSTRUMENTER_CONSTANTS.NAMESPACE, hookTestNamespace)
    .replaceAll(
      INSTRUMENTER_CONSTANTS.ACTIVE_MUTANT_ENV_VARIABLE,
      hookTestActiveMutantEnv,
    );
}

export async function startServer(
  t: TestContext,
  {
    env = {},
    server = 'answer',
    args = [],
    hooks = [serverHookUrl],
  }: {
    readonly env?: Readonly<Record<string, string>>;
    readonly server?: ServerProgram;
    readonly args?: readonly string[];
    readonly hooks?: readonly string[];
  } = {},
) {
  const dir = tempTree(t, 'server-hook-test-', {
    'app.mjs': instrumented,
    'server.mjs': readFileSync(
      new URL(`servers/${server}.mjs`, import.meta.url),
      'utf8',
    ).replaceAll(INSTRUMENTER_CONSTANTS.NAMESPACE, hookTestNamespace),
    'tls/localhost-key.pem': readFileSync(tlsKeyPath, 'utf8'),
    'tls/localhost-cert.pem': readFileSync(tlsCertPath, 'utf8'),
  });
  const serverDir = path.join(dir, 'server');
  mkdirSync(serverDir);
  const child = spawn(
    process.execPath,
    [
      '--import',
      new URL('exit-when-stdin-ends.mjs', import.meta.url).href,
      ...hooks.flatMap((hook) => ['--import', hook]),
      path.join(dir, 'server.mjs'),
      ...args,
    ],
    {
      env: {
        ...process.env,
        [serverDirEnv]: serverDir,
        [hookTestNamespaceEnv]: hookTestNamespace,
        ...env,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  );
  let stderr = '';
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += String(chunk);
    process.stderr.write(chunk);
  });
  const exited = once(child, 'exit');
  exited.catch(() => undefined);
  // A kill first would run no exit listener, so the test runner's hook in the server would lose the coverage
  // it writes as the server exits.
  t.after(async () => {
    child.stdin.end();
    const stopped = await Promise.race([
      exited.then(() => true),
      setTimeout(stopTimeoutMs, false, { ref: false }),
    ]);

    if (!stopped) {
      child.kill();
      await exited;
    }
  });
  const exitedFirst = exited.then(([code]) => {
    throw new Error(
      `The server exited with code ${String(code)} before it listened:\n${stderr}`,
    );
  });
  exitedFirst.catch(() => undefined);
  const listened: unknown[] = await Promise.race([
    once(child.stdout, 'data'),
    exitedFirst,
  ]);
  const port = Number(String(listened[0]).trim());
  let runs = 0;

  return {
    serverDir,
    port,
    exited,
    run(control: Omit<ServerControl, 'outDir'>) {
      const outDir = path.join(dir, 'runs', String(runs++));
      mkdirSync(outDir, { recursive: true });
      writeServerControl(serverDir, {
        outDir,
        issuedTestIds: testIdsTheseTestsSend,
        testIdHosts: [`localhost:${port}`],
        ...control,
      });

      return outDir;
    },
    async ask({
      n,
      testId,
      via = '',
      query = {},
    }: {
      readonly n: number;
      readonly testId?: string | undefined;
      readonly via?: string;
      readonly query?: Readonly<Record<string, string>>;
    }): Promise<string> {
      const search = new URLSearchParams({ n: String(n), ...query });
      const response = await fetch(
        `http://127.0.0.1:${port}/${via}?${search}`,
        {
          headers: testId === undefined ? {} : { [testIdHeader]: testId },
        },
      );

      return response.text();
    },
  };
}

export async function startHeaderEcho(
  t: TestContext,
  host = '127.0.0.1',
): Promise<number> {
  const echo = http.createServer((request, response) =>
    response.end(String(request.headers[testIdHeader])),
  );
  echo.listen(0, host);
  await once(echo, 'listening');
  t.after(() => echo.close());
  const address = echo.address();
  assert.ok(address !== null && typeof address === 'object');

  return address.port;
}

export function coverageOf(outDir: string) {
  return mergeCoverage(readSnapshotDir(outDir).snapshots);
}

export function perTestKeysOf(outDir: string): string[] {
  return readSnapshotDir(outDir).snapshots.flatMap(({ coverage }) =>
    Object.keys(coverage?.perTest ?? {}),
  );
}

export function mutantIdsOf(
  hits: Record<string, number> | undefined,
): string[] {
  return Object.keys(hits ?? {}).sort();
}
