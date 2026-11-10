import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { setTimeout } from 'node:timers/promises';

import { hookedPrefix, serverDirEnv } from '../src/server-protocol.ts';
import {
  dryRunOptions,
  mutantRunOptions,
  warnings,
} from './support/doubles.ts';
import { autoOff, serverFake, webServer } from './support/server-fake.ts';

test('init refuses a webServer whose env sets NODE_OPTIONS', async (t) => {
  const fake = serverFake(t, {
    webServers: [{ ...webServer, env: { NODE_OPTIONS: '--inspect' } }],
  });
  const { shell } = fake.runner();

  await assert.rejects(shell.init(), {
    message: `lzPlaywright.webServer.mutate is true, but a webServer's env sets NODE_OPTIONS, which replaces the one that loads the server hook. Set NODE_OPTIONS in the environment that runs Stryker instead.`,
  });
  assert.deepEqual(fake.setups, []);
});

test('init refuses a config where only one of two webServers sets NODE_OPTIONS in its env', async (t) => {
  const fake = serverFake(t, {
    webServers: [
      { url: 'http://127.0.0.1:4820/' },
      { url: 'http://127.0.0.1:4821/', env: { NODE_OPTIONS: '--inspect' } },
    ],
    urlUp: async () => false,
  });

  await assert.rejects(fake.runner().shell.init(), {
    message:
      /^lzPlaywright\.webServer\.mutate is true, but a webServer's env sets NODE_OPTIONS/,
  });
  assert.deepEqual(fake.setups, []);
});

test("with webServer.mutate: 'auto', init turns server support off with one warning when a webServer's env sets NODE_OPTIONS", async (t) => {
  const fake = serverFake(t, {
    webServers: [{ ...webServer, env: { NODE_OPTIONS: '--inspect' } }],
  });
  const { shell, lines } = fake.runner({ mutate: 'auto' });

  await shell.init();

  assert.deepEqual(warnings(lines), [
    "lzPlaywright.webServer.mutate is 'auto', but a webServer's env sets NODE_OPTIONS, which replaces the one that " +
      'loads the server hook. Set NODE_OPTIONS in the environment that runs Stryker instead.' +
      autoOff,
  ]);
  assert.deepEqual(
    fake.setups.map(({ serverDir }) => serverDir),
    [undefined],
  );
});

test('init refuses a reuseExistingServer server that already answers, and starts one that does not', async (t) => {
  const shared = serverFake(t, {
    webServers: [{ url: 'http://localhost:4820/', reuseExistingServer: true }],
    urlUp: async () => true,
  });

  await assert.rejects(shared.runner().shell.init(), (error) => {
    assert.ok(error instanceof Error);
    assert.equal(
      error.message,
      'lzPlaywright.webServer.mutate is true, but the webServer at http://localhost:4820/ already answers and ' +
        'reuseExistingServer is true. Only the Stryker process that started a server can switch its mutant: ' +
        'stop the server that answers there, or give the webServer a port that no other server uses.',
    );

    return true;
  });
  assert.deepEqual(shared.setups, []);
});

test("with webServer.mutate: 'auto', init turns server support off with one warning when a reuseExistingServer server already answers", async (t) => {
  const fake = serverFake(t, {
    webServers: [{ url: 'http://localhost:4820/', reuseExistingServer: true }],
    urlUp: async () => true,
  });
  const { shell, lines } = fake.runner({ mutate: 'auto' });

  await shell.init();

  const [warning, ...more] = warnings(lines);
  assert.equal(more.length, 0);
  assert.match(
    warning ?? '',
    /^lzPlaywright\.webServer\.mutate is 'auto', but the webServer at http:\/\/localhost:4820\/ already answers and reuseExistingServer is true\./,
  );
  assert.ok(warning?.endsWith(autoOff));
  assert.deepEqual(
    fake.setups.map(({ serverDir }) => serverDir),
    [undefined],
  );
});

test('init names every reuseExistingServer server that already answers', async (t) => {
  const fake = serverFake(t, {
    webServers: [
      { url: 'http://localhost:4820/', reuseExistingServer: true },
      { url: 'http://localhost:4821/', reuseExistingServer: true },
    ],
    urlUp: async () => true,
  });

  await assert.rejects(fake.runner().shell.init(), {
    message:
      /^lzPlaywright\.webServer\.mutate is true, but the webServer at http:\/\/localhost:4820\/, http:\/\/localhost:4821\/ already answers/,
  });
});

test('init starts a reuseExistingServer server that does not answer yet', async (t) => {
  const fake = serverFake(t, {
    webServers: [{ url: 'http://localhost:4820/', reuseExistingServer: true }],
    urlUp: async () => false,
  });

  await fake.runner().shell.init();

  assert.equal(fake.setups.length, 1);
});

test("with webServer.mutate: 'auto', init turns server support off with one warning when no process global setup started loaded the server hook", async (t) => {
  const fake = serverFake(t, { hooked: false });
  const { shell, lines } = fake.runner({ mutate: 'auto' });

  await shell.init();
  await shell.dryRun(dryRunOptions());

  assert.deepEqual(warnings(lines), [
    "lzPlaywright.webServer.mutate is 'auto', but no process that Playwright global setup started loaded the server hook. " +
      'A webServer that is not Node.js, a command that sets NODE_OPTIONS itself, or a server that was already running ' +
      'cannot get the active mutant.' +
      autoOff,
  ]);
  assert.equal(fake.setups.at(-1)?.serverDir, undefined);
  assert.equal(fake.runs[0]?.settings.testIdHosts, undefined);
});

test('the dry run tags requests to the host of each webServer by its port or its url, and to no host for a webServer with neither', async (t) => {
  const fake = serverFake(t, {
    webServers: [{ port: 4820 }, { url: 'http://app.test:4821/' }, {}],
    urlUp: async () => false,
  });
  const { shell } = fake.runner();
  await shell.init();

  await shell.dryRun(dryRunOptions());

  assert.deepEqual(fake.runs[0]?.settings.testIdHosts, [
    'localhost:4820',
    'app.test:4821',
  ]);
});

test("with webServer.mutate: 'auto', init that turns server support off gives the timeout warning once, after the warning that turns it off", async (t) => {
  const fake = serverFake(t, { hooked: false });
  const { shell, lines } = fake.runner({ mutate: 'auto', timeoutMS: 100 });

  await shell.init();

  const [autoWarning, timeoutWarning, ...more] = warnings(lines);
  assert.ok(autoWarning?.endsWith(autoOff));
  assert.match(timeoutWarning ?? '', /timeout/i);
  assert.deepEqual(more, []);
});

test('init accepts a webServer that loads the server hook shortly after global setup returns', async (t) => {
  const fake = serverFake(t, {
    hooked: false,
    globalSetup: () => {
      const serverDir = process.env[serverDirEnv];

      if (serverDir !== undefined) {
        void setTimeout(100).then(() =>
          writeFileSync(path.join(serverDir, `${hookedPrefix}1`), ''),
        );
      }

      return 'passed';
    },
  });

  await fake.runner().shell.init();

  assert.equal(fake.setups.length, 1);
});

test('init fails when no process global setup started loaded the server hook', async (t) => {
  const fake = serverFake(t, { hooked: false });

  await assert.rejects(fake.runner().shell.init(), {
    message:
      'lzPlaywright.webServer.mutate is true, but no process that Playwright global setup started loaded the server hook. ' +
      'A webServer that is not Node.js, a command that sets NODE_OPTIONS itself, or a server that was already running ' +
      'cannot get the active mutant.',
  });
});

test("with webServer.mutate: 'auto', a later webServer restart that loads no server hook fails with a message that says 'auto'", async (t) => {
  let hooks = true;
  const fake = serverFake(t, { hooked: () => hooks });
  const { shell } = fake.runner({ mutate: 'auto', isolate: false });
  await shell.init();
  hooks = false;

  await assert.rejects(
    shell.mutantRun(mutantRunOptions({ mutantActivation: 'static' })),
    {
      message:
        "lzPlaywright.webServer.mutate is 'auto', but no process that Playwright global setup started loaded the server hook. " +
        'A webServer that is not Node.js, a command that sets NODE_OPTIONS itself, or a server that was already running ' +
        'cannot get the active mutant.',
    },
  );
});
