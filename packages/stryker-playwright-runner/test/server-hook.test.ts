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
const serverSource = [
  "import http from 'node:http';",
  "import { answer } from './app.mjs';",
  'const server = http.createServer((request, response) => {',
  "  const n = Number(new URL(request.url, 'http://x').searchParams.get('n'));",
  '  response.end(answer(n));',
  '});',
  "server.listen(0, '127.0.0.1', () => console.log(server.address().port));",
  '',
].join('\n');
let instrumented = '';

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
});

async function startServer(
  t: TestContext,
  env: Readonly<Record<string, string>> = {},
) {
  const dir = tempTree(t, 'server-hook-test-', {
    'app.mjs': instrumented,
    'server.mjs': serverSource,
  });
  const serverDir = path.join(dir, 'server');
  mkdirSync(serverDir);
  const child = spawn(
    process.execPath,
    ['--import', serverHookUrl, path.join(dir, 'server.mjs')],
    {
      env: { ...process.env, [serverDirEnv]: serverDir, ...env },
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
    /** Writes the control file for the next run and returns that run's folder. */
    run(control: Omit<ServerControl, 'outDir'>) {
      const outDir = path.join(dir, 'runs', String(runs++));
      mkdirSync(outDir, { recursive: true });
      writeServerControl(serverDir, { outDir, ...control });

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

function idsOf(hits: Record<string, number> | undefined): string[] {
  return Object.keys(hits ?? {}).sort();
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
    [INSTRUMENTER_CONSTANTS.ACTIVE_MUTANT_ENV_VARIABLE]: '0',
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
    idsOf(coverage.static),
    ['0', '1', '2', '3', '4', '5', '6'],
    'module scope, and a request before any run, such as a readiness check',
  );
  assert.deepEqual(idsOf(coverage.perTest['big']), [
    '1',
    '2',
    '3',
    '4',
    '5',
    '6',
  ]);
  assert.deepEqual(idsOf(coverage.perTest['small']), [
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
  assert.ok(
    arrivedAt !== undefined && sent <= arrivedAt && arrivedAt <= answered,
    key,
  );
});

test('without per-test coverage every hit is static, header or not', async (t) => {
  const server = await startServer(t);
  const outDir = server.run({ perTest: false });
  await server.ask(0, 'small');

  const coverage = coverageOf(outDir);

  assert.deepEqual(Object.keys(coverage.perTest), []);
  assert.deepEqual(idsOf(coverage.static), ['0', '1', '2', '3', '4', '5', '7']);
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
