// The server hook in a real node:http server that serves code Stryker's instrumenter instrumented, started
// with the hook through NODE_OPTIONS-style --import, as global setup starts a webServer.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { before, type TestContext, test } from 'node:test';

import { INSTRUMENTER_CONSTANTS } from '@stryker-mutator/api/core';
import { Instrumenter } from '@stryker-mutator/instrumenter';

import { readSnapshotDir } from '../src/protocol.ts';
import { mergeCoverage } from '../src/run-result.ts';
import {
  anyHooked,
  type ServerControl,
  serverDirEnv,
  serverSnapshotPrefix,
  testIdHeader,
  untaggedArrival,
  writeServerControl,
} from '../src/server-protocol.ts';
import { logger, tempTree, withoutPrototypes } from './support/doubles.ts';

const serverHookUrl = new URL('../src/server-hook.ts', import.meta.url).href;
// Mutant ids the instrumenter gives this source: 0 is 'hi', run once at module scope; 2 makes the condition
// true; 6 empties ' many'; 7 empties 'one'.
const source = [
  "const greeting = 'hi';",
  'export function answer(n) {',
  "  return n > 1 ? greeting + ' many' : 'one';",
  '}',
  '',
].join('\n');
const bigRequestIds = ['1', '2', '3', '4', '5', '6'];
const testIdsTheseTestsSend = ['big', 'small'];
const namespaceGlobal = `globalThis.${INSTRUMENTER_CONSTANTS.NAMESPACE}`;
const answerLines = [
  "const n = Number(new URL(request.url, 'http://x').searchParams.get('n'));",
  'response.end(answer(n));',
];
const serverSource = serverSourceOf(answerLines, [
  "import { answer } from './app.mjs';",
]);
const lazyServerSource = serverSourceOf([
  "const { answer } = await import('./app.mjs');",
  ...answerLines,
]);
const withoutTestRunnerHooksAndActiveMutant = {
  NODE_OPTIONS: undefined,
  [INSTRUMENTER_CONSTANTS.ACTIVE_MUTANT_ENV_VARIABLE]: undefined,
};
let instrumented = '';
let appMutantIds: ReadonlySet<string> = new Set();

before(async () => {
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
  instrumented = file.content;
  appMutantIds = new Set(result.mutants.map(({ id }) => id));
});

function serverSourceOf(
  handler: readonly string[],
  imports: readonly string[] = [],
): string {
  return [
    "import http from 'node:http';",
    ...imports,
    'const server = http.createServer(async (request, response) => {',
    ...handler.map((line) => `  ${line}`),
    '});',
    "server.listen(0, '127.0.0.1', () => process.stdout.write(`${server.address().port}\\n`));",
    '',
  ].join('\n');
}

async function startServer(
  t: TestContext,
  {
    env = {},
    server = serverSource,
    hooks = [serverHookUrl],
  }: {
    readonly env?: Readonly<Record<string, string>>;
    readonly server?: string;
    readonly hooks?: readonly string[];
  } = {},
) {
  const dir = tempTree(t, 'server-hook-test-', {
    'app.mjs': instrumented,
    'server.mjs': server,
  });
  const serverDir = path.join(dir, 'server');
  mkdirSync(serverDir);
  const child = spawn(
    process.execPath,
    [
      ...hooks.flatMap((hook) => ['--import', hook]),
      path.join(dir, 'server.mjs'),
    ],
    {
      env: {
        ...process.env,
        ...withoutTestRunnerHooksAndActiveMutant,
        [serverDirEnv]: serverDir,
        ...env,
      },
      stdio: ['ignore', 'pipe', 'inherit'],
    },
  );
  t.after(async () => {
    child.kill();
    await once(child, 'exit');
  });
  const listened: unknown[] = await once(child.stdout, 'data');
  const port = Number(String(listened[0]).trim());
  let runs = 0;

  return {
    serverDir,
    run(control: Omit<ServerControl, 'outDir'>) {
      const outDir = path.join(dir, 'runs', String(runs++));
      mkdirSync(outDir, { recursive: true });
      writeServerControl(serverDir, {
        outDir,
        issuedTestIds: testIdsTheseTestsSend,
        ...control,
      });

      return outDir;
    },
    async ask(n: number, testId?: string): Promise<string> {
      const response = await fetch(`http://127.0.0.1:${port}/?n=${n}`, {
        headers: testId === undefined ? {} : { [testIdHeader]: testId },
      });

      return response.text();
    },
  };
}

function coverageOf(outDir: string) {
  return mergeCoverage(readSnapshotDir(outDir).snapshots);
}

function appMutantIdsOf(hits: Record<string, number> | undefined): string[] {
  return Object.keys(hits ?? {})
    .filter((id) => appMutantIds.has(id))
    .sort();
}

test('the hook marks its server hooked once it listens', async (t) => {
  const server = await startServer(t);

  assert.equal(anyHooked(server.serverDir), true);
});

test('the active mutant switches per request from the control file, without a restart', async (t) => {
  const server = await startServer(t);

  assert.equal(await server.ask(0), 'one', 'no control file yet');

  server.run({ perTest: false, activeMutant: '2' });

  assert.equal(await server.ask(0), 'hi many');

  server.run({ perTest: false, activeMutant: '7' });

  assert.equal(await server.ask(0), '');
  assert.equal(await server.ask(2), 'hi many');

  server.run({ perTest: false });

  assert.equal(await server.ask(0), 'one');
});

test('a mutant run once at module scope is active only in a server started with it', async (t) => {
  const switched = await startServer(t);
  switched.run({ perTest: false, activeMutant: '0' });

  assert.equal(await switched.ask(2), 'hi many');

  const started = await startServer(t, {
    env: { [INSTRUMENTER_CONSTANTS.ACTIVE_MUTANT_ENV_VARIABLE]: '0' },
  });
  started.run({ perTest: false, activeMutant: '0' });

  assert.equal(await started.ask(2), ' many');
});

test('coverage goes to the run folder per test id header, with what ran before the first run as static', async (t) => {
  const server = await startServer(t);
  await server.ask(2, 'before-any-run');
  const first = server.run({ perTest: true });
  await Promise.all([server.ask(2, 'big'), server.ask(0, 'small')]);
  const second = server.run({ perTest: true });
  await server.ask(0, 'small');

  const coverage = coverageOf(first);

  assert.ok(
    readdirSync(first).every((file) => file.startsWith(serverSnapshotPrefix)),
  );
  assert.deepEqual(
    appMutantIdsOf(coverage.static),
    ['0', '1', '2', '3', '4', '5', '6'],
    'module scope, and a request before any run, such as a readiness check',
  );
  assert.deepEqual(appMutantIdsOf(coverage.perTest['big']), bigRequestIds);
  assert.deepEqual(appMutantIdsOf(coverage.perTest['small']), [
    '1',
    '2',
    '3',
    '4',
    '5',
    '7',
  ]);
  assert.equal(coverage.perTest['before-any-run'], undefined);
  assert.deepEqual(
    withoutPrototypes(coverageOf(second)),
    withoutPrototypes({
      static: {},
      perTest: { small: coverage.perTest['small'] },
    }),
    'each run gets only its own hits',
  );
});

test("module scope evaluated lazily inside a request is static, and the rest of that request is its test's", async (t) => {
  const server = await startServer(t, { server: lazyServerSource });
  const outDir = server.run({ perTest: true });
  await server.ask(2, 'big');

  const coverage = coverageOf(outDir);

  assert.deepEqual(appMutantIdsOf(coverage.static), ['0']);
  assert.deepEqual(appMutantIdsOf(coverage.perTest['big']), bigRequestIds);
});

test('hits count as static only until the microtask after the first read of the namespace global', async (t) => {
  const server = await startServer(t, {
    server: serverSourceOf([
      `const ns = ${namespaceGlobal};`,
      'const during = ns.currentTestId;',
      'await null;',
      'response.end(JSON.stringify([during, ns.currentTestId]));',
    ]),
  });
  server.run({ perTest: true });

  assert.equal(await server.ask(0, 'small'), '[null,"small"]');
});

test('a read of the namespace global inside an open window does not keep it open', async (t) => {
  const server = await startServer(t, {
    server: serverSourceOf([
      `queueMicrotask(() => ${namespaceGlobal});`,
      `const ns = ${namespaceGlobal};`,
      'await null;',
      'response.end(String(ns.currentTestId));',
    ]),
  });
  server.run({ perTest: true });

  assert.equal(await server.ask(0, 'small'), 'small');
});

test('a read of the namespace global inside an open window schedules no close that ends a later window early', async (t) => {
  const server = await startServer(t, {
    server: serverSourceOf([
      `queueMicrotask(() => ${namespaceGlobal});`,
      `const ns = ${namespaceGlobal};`,
      'const later = await new Promise((resolve) => {',
      '  queueMicrotask(() => {',
      '    queueMicrotask(() => resolve(ns.currentTestId));',
      `    ${namespaceGlobal};`,
      '  });',
      '});',
      'response.end(JSON.stringify([later]));',
    ]),
  });
  server.run({ perTest: true });

  assert.equal(await server.ask(0, 'small'), '[null]');
});

test('code that runs outside any request names no test', async (t) => {
  const server = await startServer(t, {
    server: serverSourceOf(
      [
        'const outside = await new Promise((resolve) => waiting.push(resolve));',
        'response.end(String(outside));',
      ],
      [
        `const ns = ${namespaceGlobal};`,
        'const waiting = [];',
        'setInterval(() => waiting.splice(0).forEach((resolve) => resolve(ns.currentTestId)), 5).unref();',
      ],
    ),
  });
  server.run({ perTest: true });

  assert.equal(await server.ask(0, 'small'), 'undefined');
});

test('a second copy of the hook leaves lazily evaluated module scope static', async (t) => {
  const server = await startServer(t, {
    server: lazyServerSource,
    hooks: [serverHookUrl, `${serverHookUrl}?copy`],
  });
  const outDir = server.run({ perTest: true });
  await server.ask(2, 'big');

  const coverage = coverageOf(outDir);

  assert.deepEqual(appMutantIdsOf(coverage.static), ['0']);
  assert.deepEqual(appMutantIdsOf(coverage.perTest['big']), bigRequestIds);
});

test('without per-test coverage lazily evaluated module scope and the request are static', async (t) => {
  const server = await startServer(t, { server: lazyServerSource });
  const outDir = server.run({ perTest: false });
  await server.ask(2, 'big');

  const coverage = coverageOf(outDir);

  assert.deepEqual(Object.keys(coverage.perTest), []);
  assert.deepEqual(appMutantIdsOf(coverage.static), [
    '0',
    '1',
    '2',
    '3',
    '4',
    '5',
    '6',
  ]);
});

test('assigning the namespace global is ignored, not a throw', async (t) => {
  const server = await startServer(t, {
    server: serverSourceOf([
      `const before = ${namespaceGlobal};`,
      'try {',
      `  ${namespaceGlobal} = {};`,
      '} catch (error) {',
      '  response.end(String(error));',
      '  return;',
      '}',
      `response.end(String(${namespaceGlobal} === before));`,
    ]),
  });

  assert.equal(await server.ask(0), 'true');
});

test('a request without the header counts under its arrival time', async (t) => {
  const server = await startServer(t);
  await server.ask(2);
  const outDir = server.run({ perTest: true });
  const sent = Date.now();
  await server.ask(0);
  const answered = Date.now();

  const keys = readSnapshotDir(outDir).snapshots.flatMap(({ coverage }) =>
    Object.keys(coverage?.perTest ?? {}),
  );

  assert.equal(keys.length, 1);
  const [key = ''] = keys;
  const arrivedAt = untaggedArrival(key);
  const crossProcessClockSkewMs = 50;
  assert.ok(
    arrivedAt !== undefined &&
      sent - crossProcessClockSkewMs <= arrivedAt &&
      arrivedAt <= answered + crossProcessClockSkewMs,
    `${sent} ${key} ${answered}`,
  );
});

test('a test id header the runner did not issue counts as untagged, under its arrival time', async (t) => {
  const server = await startServer(t);
  const outDir = server.run({ perTest: true });
  await server.ask(0, '__proto__');

  const keys = readSnapshotDir(outDir).snapshots.flatMap(({ coverage }) =>
    Object.keys(coverage?.perTest ?? {}),
  );

  assert.equal(keys.length, 1);
  assert.notEqual(untaggedArrival(keys[0] ?? ''), undefined, keys[0]);
});

test('without per-test coverage every hit is static, header or not', async (t) => {
  const server = await startServer(t);
  const outDir = server.run({ perTest: false });
  await server.ask(0, 'small');

  const coverage = coverageOf(outDir);

  assert.deepEqual(Object.keys(coverage.perTest), []);
  assert.deepEqual(appMutantIdsOf(coverage.static), [
    '0',
    '1',
    '2',
    '3',
    '4',
    '5',
    '7',
  ]);
});

test("a run's hit count counts only the active mutant's hits in that run", async (t) => {
  const server = await startServer(t);
  const first = server.run({ perTest: false, activeMutant: '7', hitLimit: 10 });
  await server.ask(0);
  await server.ask(0);
  await server.ask(2);
  const second = server.run({
    perTest: false,
    activeMutant: '7',
    hitLimit: 10,
  });
  await server.ask(0);

  const hits = (outDir: string) =>
    readSnapshotDir(outDir).snapshots.reduce(
      (sum, { hitCount }) => sum + hitCount,
      0,
    );

  assert.equal(hits(first), 2);
  assert.equal(hits(second), 1);
});

test('a run folder that is gone drops the coverage, and the server keeps serving', async (t) => {
  const server = await startServer(t);
  writeServerControl(server.serverDir, {
    outDir: path.join(server.serverDir, 'gone'),
    perTest: true,
  });

  assert.equal(await server.ask(0, 'small'), 'one');
  assert.equal(await server.ask(2, 'big'), 'hi many');
});
