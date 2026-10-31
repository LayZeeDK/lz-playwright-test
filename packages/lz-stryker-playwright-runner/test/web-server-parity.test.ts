// The runner's webServer check against the installed Playwright's own decision for the same config file.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { type TestContext, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { fieldOf } from '../src/is-record.ts';
import { loadPlaywright } from '../src/playwright-internals.ts';
import { serverTarget } from '../src/playwright-test-runner.ts';
import { tempTree } from './support/doubles.ts';

type Decision =
  | 'refused'
  | readonly (
      | { readonly port: number }
      | { readonly url: string; readonly ignoreHTTPSErrors: boolean }
      | undefined
    )[];

const packageJson = fileURLToPath(new URL('../package.json', import.meta.url));
const playwright = loadPlaywright(packageJson);
const playwrightRequire = createRequire(
  createRequire(packageJson).resolve('@playwright/test'),
);

function writeConfig(t: TestContext, webServer: string): string {
  const dir = tempTree(t, 'lz-web-server-', {
    'playwright.config.cjs': `module.exports = { webServer: ${webServer} };\n`,
  });

  return path.join(dir, 'playwright.config.cjs');
}

async function playwrightDecision(configFile: string): Promise<Decision> {
  const runnerModule: unknown = playwrightRequire('playwright/lib/runner');
  const commonModule: unknown = playwrightRequire('playwright/lib/common');
  const TestRunner = fieldOf(fieldOf(runnerModule, 'testRunner'), 'TestRunner');
  const configLoader = fieldOf(commonModule, 'configLoader');
  const resolveConfigLocation = fieldOf(configLoader, 'resolveConfigLocation');
  assert.ok(
    typeof TestRunner === 'function' &&
      typeof resolveConfigLocation === 'function',
  );
  const runner: unknown = Reflect.construct(TestRunner, [
    Reflect.apply(resolveConfigLocation, configLoader, [configFile]),
    {},
  ]);
  const loadConfig = fieldOf(runner, 'loadConfig');
  assert.ok(typeof loadConfig === 'function');
  let config: unknown;

  try {
    config = await Reflect.apply(loadConfig, runner, []);
  } catch {
    return 'refused';
  }

  const plugins = fieldOf(config, 'plugins');
  assert.ok(Array.isArray(plugins));

  // Playwright's WebServerPlugin checks the url's port when checkPortOnly is set, else the url itself.
  return plugins
    .map((plugin: unknown) => fieldOf(plugin, 'factory'))
    .filter((factory) => fieldOf(factory, 'name') === 'playwright:webserver')
    .map((factory) => {
      const options = fieldOf(factory, '_options');
      const url = fieldOf(options, 'url');

      if (url === undefined || url === '') {
        return undefined;
      }

      assert.ok(typeof url === 'string' || url instanceof URL);
      const target = new URL(url);

      return fieldOf(factory, '_checkPortOnly') === true
        ? { port: Number(target.port) }
        : {
            url: target.href,
            ignoreHTTPSErrors: fieldOf(options, 'ignoreHTTPSErrors') === true,
          };
    });
}

async function runnerDecision(configFile: string): Promise<Decision> {
  let webServers;

  try {
    const runner = await playwright.createTestRunner(configFile, {});
    ({ webServers } = await runner.loadConfig());
  } catch {
    return 'refused';
  }

  return webServers.map((server) => {
    const target = serverTarget(server);

    if (target === undefined) {
      return undefined;
    }

    return 'port' in target
      ? { port: target.port }
      : {
          url: new URL(target.url).href,
          ignoreHTTPSErrors: server.ignoreHTTPSErrors,
        };
  });
}

function kindOf(decision: Decision): string {
  if (decision === 'refused') {
    return decision;
  }

  return decision
    .map((check) => {
      if (check === undefined) {
        return 'none';
      }

      return 'port' in check ? 'port' : 'url';
    })
    .join(',');
}

const command = `command: 'node --version'`;
const cases: readonly (readonly [string, string, string])[] = [
  ['a url', `{ ${command}, url: 'http://localhost:3000/health' }`, 'url'],
  [
    'a url with ignoreHTTPSErrors',
    `{ ${command}, url: 'https://localhost:3001/', ignoreHTTPSErrors: true }`,
    'url',
  ],
  [
    'a URL object',
    `{ ${command}, url: new URL('http://localhost:3002/') }`,
    'url',
  ],
  ['a port', `{ ${command}, port: 3003 }`, 'port'],
  ['a port as a string', `{ ${command}, port: '3004' }`, 'port'],
  ['port 0 alone', `{ ${command}, port: 0 }`, 'none'],
  ['neither port nor url', `{ ${command} }`, 'none'],
  ['an empty url beside a port', `{ ${command}, url: '', port: 3005 }`, 'port'],
  ['a null url beside a port', `{ ${command}, url: null, port: 3006 }`, 'port'],
  [
    'port 0 beside a url',
    `{ ${command}, url: 'http://localhost:3007/x', port: 0 }`,
    'port',
  ],
  [
    'port 0 beside a url without a port',
    `{ ${command}, url: 'http://localhost/x', port: 0 }`,
    'port',
  ],
  [
    'a null port beside a url',
    `{ ${command}, url: 'http://localhost:3008/', port: null }`,
    'port',
  ],
  [
    'both a port and a url',
    `{ ${command}, url: 'http://localhost:3009/', port: 3009 }`,
    'refused',
  ],
  [
    'two servers',
    `[{ ${command}, url: 'http://localhost:3010/' }, { ${command}, port: 3011 }]`,
    'url,port',
  ],
];

cases.forEach(([name, webServer, kind]) => {
  test(`checks the server Playwright checks for ${name}`, async (t) => {
    const baseUrl = process.env['PLAYWRIGHT_TEST_BASE_URL'];
    t.after(() => {
      if (baseUrl === undefined) {
        delete process.env['PLAYWRIGHT_TEST_BASE_URL'];
      } else {
        process.env['PLAYWRIGHT_TEST_BASE_URL'] = baseUrl;
      }
    });
    const configFile = writeConfig(t, webServer);

    const expected = await playwrightDecision(configFile);

    assert.equal(kindOf(expected), kind);
    assert.deepEqual(await runnerDecision(configFile), expected);
  });
});
