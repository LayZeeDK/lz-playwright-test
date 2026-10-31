// The runner's shell against the fake Playwright install in support/fake-playwright.ts.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs, { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { PluginKind } from '@stryker-mutator/api/plugin';
import {
  DryRunStatus,
  MutantRunStatus,
  TestStatus,
} from '@stryker-mutator/api/test-runner';

import { strykerPlugins, strykerValidationSchema } from '../src/index.ts';
import { optionProperties } from '../src/options.ts';
import { fieldOf } from '../src/is-record.ts';
import { installErrorSuffix } from '../src/protocol.ts';
import {
  acceptsConnections,
  LzStrykerPlaywrightTestRunner,
  withEnv,
} from '../src/playwright-test-runner.ts';
import { namespaceToken, ownerFile, rootPrefix } from '../src/temp-root.ts';
import {
  dryRunOptions,
  finishedTest,
  logger,
  mutantRunOptions,
  withoutPrototypes,
  strykerOptions,
} from './support/doubles.ts';
import {
  activeMutantEnv,
  fakePlaywright,
  passAll,
  stubEnv,
  writeSnapshots,
} from './support/fake-playwright.ts';

const workerHookUrl = new URL('../src/worker-hook.ts', import.meta.url).href;

async function listening(): Promise<{ server: net.Server; port: number }> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, 'localhost', resolve));
  const address = server.address();
  assert.ok(typeof address === 'object' && address !== null);

  return { server, port: address.port };
}

test('the package declares the runner as the lz-stryker-playwright test runner, with its options schema', () => {
  assert.deepEqual(strykerPlugins, [
    {
      kind: PluginKind.TestRunner,
      name: 'lz-stryker-playwright',
      injectableClass: LzStrykerPlaywrightTestRunner,
    },
  ]);
  assert.equal(
    strykerValidationSchema.properties.lzStrykerPlaywright.properties,
    optionProperties,
  );
});

test('the runner can reload its environment', () => {
  assert.deepEqual(
    new LzStrykerPlaywrightTestRunner(
      strykerOptions({}),
      logger().log,
    ).capabilities(),
    { reloadEnvironment: true },
  );
});

test('init creates the TestRunner on the resolved config with the run overrides, then sets up and lists', async (t) => {
  const fake = fakePlaywright(t, {
    projects: [
      { default: true, project: { name: 'chromium', timeout: 30_000 } },
      { default: false, project: { name: 'manual', timeout: 30_000 } },
    ],
  });
  const { shell } = fake.runner();

  await shell.init();

  const [first, ...rest] = fake.calls;
  assert.ok(first);
  const [, configLocation, overrides] = first;
  const outputDir = fieldOf(overrides, 'outputDir');
  assert.ok(typeof outputDir === 'string');

  assert.deepEqual(configLocation, { resolved: fake.configFile });
  assert.deepEqual(overrides, {
    outputDir,
    use: { screenshot: 'off', trace: 'off', video: 'off' },
  });
  assert.match(
    path.basename(path.dirname(outputDir)),
    /^lz-stryker-playwright-\d+-/,
  );
  assert.equal(path.dirname(path.dirname(outputDir)), fake.tmp);
  assert.deepEqual(rest, [
    ['initialize', {}],
    ['loadConfig'],
    ['runGlobalSetup'],
    ['listTests', { projects: ['chromium'] }],
  ]);
});

test('init lists the projects the option names', async (t) => {
  const fake = fakePlaywright(t);
  const { shell } = fake.runner({
    lzStrykerPlaywright: { projects: ['manual'] },
  });

  await shell.init();

  assert.deepEqual(fake.calls.at(-1), ['listTests', { projects: ['manual'] }]);
});

test('without a config file, Playwright is found from the working directory', async (t) => {
  const fake = fakePlaywright(t);
  const cwd = process.cwd();
  const { shell } = fake.runner({
    lzStrykerPlaywright: { configFile: undefined },
  });
  process.chdir(fake.dir);

  try {
    await shell.init();
  } finally {
    process.chdir(cwd);
  }

  const [first] = fake.calls;
  assert.ok(first);
  assert.deepEqual(first[1], { resolved: undefined });
});

['1.62.9', '2.0.0'].forEach((version) => {
  test(`init refuses Playwright ${version}`, async (t) => {
    const fake = fakePlaywright(t, {}, version);
    const { shell } = fake.runner();

    await assert.rejects(shell.init(), {
      message: `The Playwright test runner needs Playwright 1.63 or a later 1.x release, found ${version}.`,
    });
    assert.deepEqual(fake.calls, []);
  });
});

test('init refuses a Playwright whose package.json names no version', async (t) => {
  const fake = fakePlaywright(t);
  writeFileSync(
    path.join(fake.dir, 'node_modules', 'playwright', 'package.json'),
    '{"name":"playwright"}',
  );
  const { shell } = fake.runner();

  await assert.rejects(shell.init(), {
    message:
      'The Playwright test runner needs Playwright 1.63 or a later 1.x release, found undefined.',
  });
  assert.deepEqual(fake.calls, []);
});

test('init warns when timeoutMS is below twice the expect timeout, and only then', async (t) => {
  const fake = fakePlaywright(t);
  const low = fake.runner({ timeoutMS: 9_999 });
  const enough = fake.runner({ timeoutMS: 10_000 });

  await low.shell.init();
  await enough.shell.init();

  assert.deepEqual(
    low.lines.filter(([level]) => level === 'warn'),
    [
      [
        'warn',
        'timeoutMS (9999) is below twice the Playwright expect timeout (5000); killed mutants may be reported as timeouts. Set timeoutMS to at least 10000.',
      ],
    ],
  );
  assert.deepEqual(enough.lines, []);
});

function leaveDeadRoots(tmp: string, suffixes: string[]): string[] {
  const dead = spawnSync(process.execPath, ['-e', '']).pid;

  return suffixes.map((suffix) => {
    const name = `${rootPrefix}${dead}-${suffix}`;
    mkdirSync(path.join(tmp, name));
    writeFileSync(path.join(tmp, name, ownerFile), namespaceToken());

    return name;
  });
}

test('init removes the temp roots of runners that no longer run, and says so', async (t) => {
  const fake = fakePlaywright(t);
  const left = leaveDeadRoots(fake.tmp, ['abc123', 'def456']);
  const { shell, lines } = fake.runner();
  const prefix = 'Removed the temp directories of runners that no longer run: ';

  await shell.init();

  assert.deepEqual(
    left.map((name) => existsSync(path.join(fake.tmp, name))),
    [false, false],
  );
  assert.equal(lines.length, 1);
  const [line] = lines;
  assert.ok(line);
  const [level, message] = line;
  assert.equal(level, 'debug');
  assert.ok(message.startsWith(prefix), message);
  // In the order the directory lists them, which depends on the file system.
  assert.deepEqual(message.slice(prefix.length).split(', ').sort(), left);
});

test('init says which temp roots it removed before it creates its own, so a failed create keeps the line', async (t) => {
  const fake = fakePlaywright(t);
  const left = leaveDeadRoots(fake.tmp, ['abc123']);
  const { shell, lines } = fake.runner();
  t.mock.method(fs, 'mkdtempSync', () => {
    throw new Error('ENOSPC');
  });

  await assert.rejects(shell.init(), { message: 'ENOSPC' });
  t.mock.restoreAll();

  assert.deepEqual(lines, [
    [
      'debug',
      `Removed the temp directories of runners that no longer run: ${left.join(', ')}`,
    ],
  ]);
});

test('the temp root init creates holds the namespace token its sweep matches', async (t) => {
  const fake = fakePlaywright(t);
  const { shell } = fake.runner();

  await shell.init();

  const [rootName] = readdirSync(fake.tmp);
  assert.ok(rootName);
  assert.equal(
    fs.readFileSync(path.join(fake.tmp, rootName, ownerFile), 'utf8'),
    namespaceToken(),
  );
});

test('a failed global setup fails init with its errors and output, and cleans up', async (t) => {
  const fake = fakePlaywright(t, {
    globalSetup: (reporter) => {
      reporter.onError?.({ message: 'setup broke' });
      reporter.onError?.({ message: 'and again' });
      reporter.onStdOut?.('server log', undefined, undefined);

      return 'failed';
    },
    globalTeardown: async () => {
      throw new Error('teardown broke too');
    },
  });
  const { shell } = fake.runner();

  await assert.rejects(shell.init(), {
    message:
      'Playwright global setup failed:\nsetup broke\nand again\nserver log',
  });
  assert.equal(fake.names().at(-1), 'runGlobalTeardown');
  assert.deepEqual(readdirSync(fake.tmp), []);
});

test('a TestRunner that fails to initialize fails init without a teardown, and cleans up', async (t) => {
  const fake = fakePlaywright(t, {
    initialize: async () => {
      throw new Error('no config');
    },
  });
  const { shell } = fake.runner();

  await assert.rejects(shell.init(), { message: 'no config' });
  assert.deepEqual(fake.names(), ['new', 'initialize']);
  assert.deepEqual(readdirSync(fake.tmp), []);
});

test('a temp root that cannot be removed after a failed init leaves the init error in place', async (t) => {
  const fake = fakePlaywright(t, {
    initialize: async () => {
      t.mock.method(fs, 'rmSync', () => {
        throw new Error('EBUSY: resource busy or locked');
      });
      throw new Error('no config');
    },
  });
  const { shell } = fake.runner();

  await assert.rejects(shell.init(), { message: 'no config' });
  t.mock.restoreAll();
});

test('a run before init finished fails with a clear error', async () => {
  const shell = new LzStrykerPlaywrightTestRunner(
    strykerOptions({}),
    logger().log,
  );

  await assert.rejects(shell.dryRun(dryRunOptions()), {
    message: 'The Playwright test runner was used before init() finished.',
  });
  await assert.rejects(shell.mutantRun(mutantRunOptions()), {
    message: 'The Playwright test runner was used before init() finished.',
  });
});

test('dispose stops the tests, tears down and removes the temp root, once', async (t) => {
  const fake = fakePlaywright(t);
  const { shell } = fake.runner();
  await shell.init();
  fake.calls.length = 0;

  await shell.dispose();
  await shell.dispose();

  assert.deepEqual(fake.names(), ['stopTests', 'runGlobalTeardown']);
  assert.deepEqual(readdirSync(fake.tmp), []);
});

test('dispose without init does nothing', async () => {
  await new LzStrykerPlaywrightTestRunner(
    strykerOptions({}),
    logger().log,
  ).dispose();
});

test('dispose removes the run folders and output before it waits for the workers', async (t) => {
  let root = '';
  let seen: string[] | undefined;
  const fake = fakePlaywright(t, {
    globalTeardown: async () => {
      seen = readdirSync(root);
    },
  });
  const { shell } = fake.runner();
  await shell.init();
  const [rootName] = readdirSync(fake.tmp);
  assert.ok(rootName);
  root = path.join(fake.tmp, rootName);
  // Playwright creates the output folder; the runner creates the runs folder.
  mkdirSync(path.join(root, 'output'));
  assert.deepEqual(readdirSync(root).sort(), ['output', ownerFile, 'runs']);

  await shell.dispose();

  assert.deepEqual(seen, [ownerFile]);
});

test('a dry run runs every test with the hook and the run settings in the workers environment', async (t) => {
  const fake = fakePlaywright(t);
  const { shell } = fake.runner({
    lzStrykerPlaywright: { projects: ['chromium'], workers: 3 },
  });
  await shell.init();
  const before = { ...process.env };

  const result = await shell.dryRun(dryRunOptions({ disableBail: true }));
  const [run] = fake.runs;
  assert.ok(run);

  assert.deepEqual(run.params, {
    locations: [],
    testIds: undefined,
    projects: ['chromium'],
    workers: 3,
    maxFailures: undefined,
    timeout: undefined,
    disableConfigReporters: true,
  });
  assert.deepEqual(run.settings, {
    outDir: run.settings.outDir,
    perTest: true,
  });
  assert.equal(run.env[activeMutantEnv], undefined);
  assert.equal(run.env['PLAYWRIGHT_NO_COPY_PROMPT'], '1');
  assert.equal(existsSync(run.settings.outDir), false);
  assert.deepEqual({ ...process.env }, before);
  assert.deepEqual(withoutPrototypes(result), {
    status: DryRunStatus.Complete,
    tests: [
      {
        id: 'a',
        name: '[e2e] › app.spec.ts › a',
        timeSpentMs: 7,
        fileName: 'app.spec.ts',
        startPosition: { line: 2, column: 4 },
        status: TestStatus.Success,
      },
    ],
    mutantCoverage: { static: {}, perTest: { a: { '1': 1 } } },
  });
});

test('the hook is preloaded before the NODE_OPTIONS the runner started with, so its own copy installs first', async (t) => {
  const fake = fakePlaywright(t);
  stubEnv(t, { NODE_OPTIONS: undefined });
  const bare = fake.runner().shell;
  process.env['NODE_OPTIONS'] = '--max-old-space-size=100';
  const based = fake.runner().shell;
  process.env['NODE_OPTIONS'] = '--changed-later';

  for (const shell of [bare, based]) {
    await shell.init();
    await shell.dryRun(dryRunOptions());
  }

  assert.deepEqual(
    fake.runs.map((run) => run.env['NODE_OPTIONS']),
    [
      `--import "${workerHookUrl}"`,
      `--import "${workerHookUrl}" --max-old-space-size=100`,
    ],
  );
  assert.equal(existsSync(fileURLToPath(workerHookUrl)), true);
});

test('a dry run stops at the first failure unless bail is disabled, and asks for coverage only per test', async (t) => {
  const fake = fakePlaywright(t);
  const { shell } = fake.runner();
  await shell.init();

  await shell.dryRun(dryRunOptions({ coverageAnalysis: 'all' }));

  const [run] = fake.runs;
  assert.ok(run);
  assert.equal(run.params.maxFailures, 1);
  assert.equal(run.settings.perTest, false);
});

test('a dry run logs the frames that lost or shared their coverage', async (t) => {
  const fake = fakePlaywright(t, {
    runTests: async (run) => {
      run.reporter.onTestEnd(finishedTest('a', 'passed'));
      writeSnapshots(run, [
        { lost: true, outlivedItsTest: false },
        { lost: true, outlivedItsTest: false },
        {
          mutantCoverage: { static: { '1': 1 }, perTest: {} },
          outlivedItsTest: true,
        },
      ]);

      return 'passed';
    },
  });
  const { shell, lines } = fake.runner();
  await shell.init();

  await shell.dryRun(dryRunOptions());

  assert.deepEqual(lines, [
    [
      'warn',
      '2 frame(s) did not answer before their context closed; their coverage is missing, so mutants only they reached show as NoCoverage.',
    ],
    [
      'info',
      '1 frame(s) belonged to contexts that outlived their test (beforeAll or worker fixtures); their coverage counts as static, so every test runs for those mutants.',
    ],
  ]);
});

test('a dry run with coverage off or no gaps logs nothing', async (t) => {
  const fake = fakePlaywright(t);
  const { shell, lines } = fake.runner();
  await shell.init();

  await shell.dryRun(dryRunOptions());
  await shell.dryRun(dryRunOptions({ coverageAnalysis: 'off' }));

  assert.deepEqual(lines, []);
});

test('a mutant run activates the mutant and runs its tests with their serial group, in its budget', async (t) => {
  const serialParent = { _parallelMode: 'serial', parent: undefined };
  const listed = ['s1', 's2'].map((id) =>
    Object.assign(finishedTest(id, 'passed'), { parent: serialParent }),
  );
  const fake = fakePlaywright(t, {
    listed,
    runTests: async (run) => {
      run.reporter.onTestEnd(finishedTest('s1', 'failed'));
      writeSnapshots(run, [{ hitCount: 3, outlivedItsTest: false }]);

      return 'failed';
    },
  });
  const { shell, lines } = fake.runner();
  await shell.init();

  const result = await shell.mutantRun(
    mutantRunOptions({ testFilter: ['s1'], hitLimit: 5, timeout: 9_000 }),
  );
  const [run] = fake.runs;
  assert.ok(run);

  assert.equal(run.env[activeMutantEnv], '7');
  assert.deepEqual(run.settings, {
    outDir: run.settings.outDir,
    perTest: false,
    hitLimit: 5,
  });
  assert.deepEqual(run.params.testIds, ['s1', 's2']);
  assert.equal(run.params.maxFailures, 1);
  assert.equal(run.params.timeout, 3_400);
  assert.deepEqual(result, {
    status: MutantRunStatus.Killed,
    failureMessage: 's1 failed',
    killedBy: ['s1'],
    nrOfTests: 1,
    duration: 7,
  });
  assert.deepEqual(lines, [['debug', 'Mutant 7: killed, hitCount 3/5']]);
});

test('a mutant run that the deadline stops is a Timeout, and the stop is logged', async (t) => {
  let stoppedEarly = true;
  const fake = fakePlaywright(t, {
    runTests: async () => {
      // The deadline is 5400 ms after the run started, less the real time init and the server
      // probe took since then.
      t.mock.timers.tick(5_000);
      stoppedEarly = fake.names().includes('stopTests');
      t.mock.timers.tick(400);
      await fake.stopped();

      return 'interrupted';
    },
  });
  const { shell, lines } = fake.runner();
  await shell.init();
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });

  const started = performance.now();
  const result = await shell.mutantRun(mutantRunOptions({ timeout: 8_000 }));
  const took = performance.now() - started;
  t.mock.timers.reset();

  assert.equal(stoppedEarly, false);
  assert.deepEqual(result, {
    status: MutantRunStatus.Timeout,
    reason: "The run reached the runner's deadline before Stryker's timeout",
  });
  const [line] = lines;
  assert.ok(line);
  const [, stopTook] = /^deadline stop took (\d+) ms$/.exec(line[1]) ?? [];
  assert.ok(
    Number(stopTook) <= Math.ceil(took),
    `stop took ${stopTook} ms of a ${took} ms run`,
  );
});

test('a run that ends on its own after the deadline fired is no deadline stop', async (t) => {
  const fake = fakePlaywright(t, {
    runTests: async (run) => {
      t.mock.timers.tick(5_400);
      await fake.stopped();

      return passAll(run);
    },
  });
  const { shell } = fake.runner();
  await shell.init();
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });

  const result = await shell.mutantRun(mutantRunOptions({ timeout: 8_000 }));
  t.mock.timers.reset();

  assert.equal(result.status, MutantRunStatus.Survived);
});

test('a run that someone else interrupted is no deadline stop', async (t) => {
  const fake = fakePlaywright(t, { runTests: async () => 'interrupted' });
  const { shell, lines } = fake.runner();
  await shell.init();

  const result = await shell.mutantRun(mutantRunOptions());

  assert.deepEqual(result, {
    status: MutantRunStatus.Error,
    errorMessage: 'The Playwright run was interrupted',
  });
  assert.deepEqual(lines, [['debug', 'Mutant 7: error, hitCount 0/undefined']]);
});

test('a run whose workers wrote no snapshot file reports that the hook never installed', async (t) => {
  const fake = fakePlaywright(t, {
    runTests: async (run) => {
      run.reporter.onTestEnd(finishedTest('a', 'passed'));
      writeFileSync(path.join(run.settings.outDir, 'worker-1.log'), '{}\n');

      return 'passed';
    },
  });
  const { shell } = fake.runner();
  await shell.init();

  const result = await shell.dryRun(dryRunOptions());

  assert.deepEqual(result, {
    status: DryRunStatus.Error,
    errorMessage:
      'Tests ran but the Stryker worker hook did not install in any Playwright worker; this Playwright version may have changed its worker entry point.',
  });
});

test('a run whose worker failed to install the hook reports the error the worker left', async (t) => {
  const fake = fakePlaywright(t, {
    runTests: async (run) => {
      run.reporter.onTestEnd(finishedTest('a', 'failed'));
      writeFileSync(
        path.join(run.settings.outDir, `worker-1${installErrorSuffix}`),
        'Error: no test.info()',
      );

      return 'failed';
    },
  });
  const { shell } = fake.runner();
  await shell.init();

  const result = await shell.dryRun(dryRunOptions());

  assert.deepEqual(result, {
    status: DryRunStatus.Error,
    errorMessage:
      'The Stryker worker hook failed to install in a Playwright worker: Error: no test.info()',
  });
});

test('each run gets its own run folder, removed after the run', async (t) => {
  const fake = fakePlaywright(t);
  const { shell } = fake.runner();
  await shell.init();

  await shell.dryRun(dryRunOptions());
  await shell.mutantRun(mutantRunOptions());

  const outDirs = fake.runs.map((run) => run.settings.outDir);

  assert.equal(new Set(outDirs).size, 2);
  assert.deepEqual(
    outDirs.map((outDir) => existsSync(outDir)),
    [false, false],
  );
});

test('a webServer url is checked over HTTP, with its HTTPS setting', async (t) => {
  const fake = fakePlaywright(t, {
    webServers: [
      { url: 'http://localhost:1/a' },
      { url: 'https://localhost:2/', ignoreHTTPSErrors: true },
    ],
  });
  const { shell } = fake.runner();
  await shell.init();

  await shell.dryRun(dryRunOptions());

  assert.deepEqual(
    fake.calls
      .filter(([name]) => name === 'isURLAvailable')
      .map(([, url, ignore]) => [String(url), ignore]),
    [
      ['http://localhost:1/a', false],
      ['https://localhost:2/', true],
    ],
  );
});

test('a webServer that died is restarted through global setup before the run, and named', async (t) => {
  let up = false;
  const fake = fakePlaywright(t, {
    webServers: [
      { url: 'http://localhost:1/' },
      { url: 'http://localhost:2/' },
      { url: 'http://localhost:3/' },
    ],
    urlUp: async (url) => url.port === '2' || up,
    globalSetup: () => {
      up = true;

      return 'passed';
    },
  });
  const { shell, lines } = fake.runner();
  await shell.init();
  up = false;
  fake.calls.length = 0;

  await shell.dryRun(dryRunOptions());

  assert.deepEqual(
    fake.names().filter((name) => name !== 'isURLAvailable'),
    ['runGlobalSetup', 'runTests'],
  );
  assert.deepEqual(lines, [
    [
      'warn',
      'webServer at http://localhost:1/, http://localhost:3/ stopped answering; rerunning Playwright global setup (global teardown runs first).',
    ],
  ]);
});

test('a run that failed while its server died is rerun once after the restart', async (t) => {
  let up = true;
  const fake = fakePlaywright(t, {
    webServers: [{ url: 'http://localhost:1/' }],
    urlUp: async () => up,
    globalSetup: () => {
      up = true;

      return 'passed';
    },
    runTests: async (run) => {
      if (fake.runs.length === 1) {
        up = false;
        run.reporter.onTestEnd(finishedTest('a', 'failed'));

        return 'failed';
      }

      return passAll(run);
    },
  });
  const { shell } = fake.runner();
  await shell.init();

  const result = await shell.mutantRun(mutantRunOptions());

  assert.equal(fake.runs.length, 2);
  assert.equal(result.status, MutantRunStatus.Survived);
});

test('a failed run whose server still answers is not rerun', async (t) => {
  const fake = fakePlaywright(t, {
    webServers: [{ url: 'http://localhost:1/' }],
    runTests: async (run) => {
      run.reporter.onTestEnd(finishedTest('a', 'failed'));
      writeSnapshots(run, []);

      return 'failed';
    },
  });
  const { shell } = fake.runner();
  await shell.init();

  const result = await shell.mutantRun(mutantRunOptions());

  assert.equal(fake.runs.length, 1);
  assert.equal(result.status, MutantRunStatus.Killed);
});

test('a restart whose global setup fails fails the run', async (t) => {
  let setups = 0;
  const fake = fakePlaywright(t, {
    webServers: [{ url: 'http://localhost:1/' }],
    urlUp: async () => false,
    globalSetup: () => (++setups === 1 ? 'passed' : 'timedout'),
  });
  const { shell } = fake.runner();
  await shell.init();

  await assert.rejects(shell.dryRun(dryRunOptions()), {
    message: 'Playwright global setup timedout:\n\n',
  });
  assert.equal(fake.runs.length, 0);
});

test('a webServer port is checked by connecting to it, and one without url or port is not checked', async (t) => {
  const { server, port } = await listening();
  t.after(() => server.close());
  const fake = fakePlaywright(t, { webServers: [{ port }, {}] });
  const { shell, lines } = fake.runner();
  await shell.init();

  await shell.dryRun(dryRunOptions());

  assert.deepEqual(lines, []);
  assert.equal(fake.runs.length, 1);
});

test('a webServer port that stopped answering is restarted and named by its port', async (t) => {
  const { server, port } = await listening();
  await new Promise((resolve) => server.close(resolve));
  const fake = fakePlaywright(t, { webServers: [{ port }] });
  const { shell, lines } = fake.runner();
  await shell.init();

  await shell.dryRun(dryRunOptions());

  assert.deepEqual(lines, [
    [
      'warn',
      `webServer at port ${port} stopped answering; rerunning Playwright global setup (global teardown runs first).`,
    ],
  ]);
});

test('a port check that neither connects nor fails gives up at its timeout, and closes the socket', async () => {
  const socket = Object.assign(new EventEmitter(), {
    destroyed: false,
    destroy() {
      this.destroyed = true;
    },
  });
  const asked: unknown[] = [];
  const answer = acceptsConnections(4321, (options) => {
    asked.push(options);

    return socket;
  });

  socket.emit('timeout');

  assert.equal(await answer, false);
  assert.deepEqual(asked, [
    { host: '127.0.0.1', port: 4321, timeout: 5000 },
    { host: '::1', port: 4321, timeout: 5000 },
  ]);
  assert.equal(socket.destroyed, true);
});

['::1', '127.0.0.1'].forEach((loopback) => {
  test(`a port answers when only ${loopback} accepts connections on it`, async () => {
    const answer = acceptsConnections(4321, (options) => {
      const socket = new net.Socket();
      setImmediate(() => {
        if (options.host === loopback) {
          socket.emit('connect');
        } else {
          socket.emit('error', new Error('ECONNREFUSED'));
        }
      });

      return socket;
    });

    assert.equal(await answer, true);
  });
});

test('a port accepts connections while a server listens on it, and not after', async (t) => {
  const { server, port } = await listening();
  t.after(() => {
    if (server.listening) {
      server.close();
    }
  });

  assert.equal(await acceptsConnections(port), true);

  await new Promise((resolve) => server.close(resolve));

  assert.equal(await acceptsConnections(port), false);
});

test('a run leaves no run settings behind in the environment, also when it throws', async (t) => {
  stubEnv(t, { WITH_ENV_KEPT: 'before', WITH_ENV_ADDED: undefined });

  const seen = await withEnv(
    { WITH_ENV_KEPT: undefined, WITH_ENV_ADDED: 'during' },
    async () => [process.env['WITH_ENV_KEPT'], process.env['WITH_ENV_ADDED']],
  );

  assert.deepEqual(seen, [undefined, 'during']);
  assert.equal(process.env['WITH_ENV_KEPT'], 'before');
  assert.equal('WITH_ENV_ADDED' in process.env, false);

  await assert.rejects(
    withEnv({ WITH_ENV_KEPT: 'during' }, async () => {
      throw new Error('run failed');
    }),
    { message: 'run failed' },
  );
  assert.equal(process.env['WITH_ENV_KEPT'], 'before');
});

test('init refuses --testFiles before it loads the Playwright config', async () => {
  const shell = new LzStrykerPlaywrightTestRunner(
    strykerOptions({
      testFiles: ['a.spec.ts'],
      lzStrykerPlaywright: { configFile: 'missing.playwright.config.ts' },
    }),
    logger().log,
  );

  await assert.rejects(shell.init(), { message: /--testFiles/ });
});
