import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { type TestContext, describe, it } from 'node:test';

import { normalizePath, resolveConfig } from 'vite';

import {
  lzStorybookStrykerPlugin,
  sandboxConfig,
} from '../src/stryker-vite-plugin.ts';

const workerVariable = 'STRYKER_MUTATOR_WORKER';

function setWorker(t: TestContext, value: string | undefined): void {
  const previous = process.env[workerVariable];

  if (value === undefined) {
    delete process.env[workerVariable];
  } else {
    process.env[workerVariable] = value;
  }

  t.after(() => {
    if (previous === undefined) {
      delete process.env[workerVariable];
    } else {
      process.env[workerVariable] = previous;
    }
  });
}

/**
 * A workspace like Stryker's sandbox: its `node_modules` links to another folder, the project's own.
 */
function linkedWorkspace(t: TestContext): {
  workspace: string;
  installed: string;
} {
  const folder = realpathSync(mkdtempSync(join(tmpdir(), 'lz-sandbox-')));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const workspace = join(folder, 'sandbox');
  const installed = join(folder, 'project', 'node_modules');
  mkdirSync(workspace);
  mkdirSync(installed, { recursive: true });
  writeFileSync(join(workspace, 'package.json'), '{ "workspaces": [] }');
  symlinkSync(installed, join(workspace, 'node_modules'), 'junction');

  return { workspace, installed };
}

function allowList(
  config: Awaited<ReturnType<typeof sandboxConfig>>,
): string[] {
  return config?.server?.fs?.allow ?? [];
}

describe('lzStorybookStrykerPlugin', () => {
  it('is named lz-storybook-stryker', () => {
    assert.equal(lzStorybookStrykerPlugin().name, 'lz-storybook-stryker');
  });

  it('sets the sandbox config as Vite resolves its config', () => {
    assert.equal(lzStorybookStrykerPlugin().config, sandboxConfig);
  });

  it("adds its folders to the user's own allow list in a Stryker worker", async (t) => {
    setWorker(t, '1');
    const { workspace, installed } = linkedWorkspace(t);

    const { server } = await resolveConfig(
      {
        root: workspace,
        configFile: false,
        logLevel: 'silent',
        plugins: [lzStorybookStrykerPlugin()],
        server: { fs: { allow: ['src'] } },
      },
      'serve',
    );

    assert.deepEqual(
      server.fs.allow.slice(0, 3),
      [join(workspace, 'src'), workspace, installed].map(normalizePath),
    );
  });
});

describe('sandboxConfig', () => {
  it('changes nothing outside a Stryker worker', async (t) => {
    setWorker(t, undefined);

    assert.equal(await sandboxConfig({ root: process.cwd() }), undefined);
  });

  it("allows the real folder of the workspace's linked node_modules in a Stryker worker", async (t) => {
    setWorker(t, '1');
    const { workspace, installed } = linkedWorkspace(t);

    const allow = allowList(await sandboxConfig({ root: workspace }));

    assert.ok(allow.includes(installed), `${installed} in ${allow.join(', ')}`);
  });

  it('keeps the workspace root, which Vite allows only while no plugin sets an allow list', async (t) => {
    setWorker(t, '1');
    const { workspace } = linkedWorkspace(t);

    const allow = allowList(await sandboxConfig({ root: workspace }));

    assert.ok(allow.includes(workspace), `${workspace} in ${allow.join(', ')}`);
  });

  it('keeps the workspace root when the Vite root is a package inside it', async (t) => {
    setWorker(t, '1');
    const { workspace } = linkedWorkspace(t);
    const packageRoot = join(workspace, 'packages', 'app');
    mkdirSync(join(packageRoot, 'node_modules'), { recursive: true });
    writeFileSync(join(packageRoot, 'package.json'), '{}');

    const allow = allowList(await sandboxConfig({ root: packageRoot }));

    assert.ok(allow.includes(workspace), `${workspace} in ${allow.join(', ')}`);
  });

  it('allows no node_modules above the workspace root', async (t) => {
    setWorker(t, '1');
    const { workspace, installed } = linkedWorkspace(t);
    mkdirSync(join(workspace, '..', 'node_modules'));

    const allow = allowList(await sandboxConfig({ root: workspace }));

    assert.deepEqual(allow, [workspace, installed]);
  });

  it('takes the working directory as the root when the config names none', async (t) => {
    setWorker(t, '1');
    const previous = process.cwd();
    // Registered before the workspace's cleanup, so the folder is no longer the working directory when it goes.
    t.after(() => process.chdir(previous));
    const { workspace, installed } = linkedWorkspace(t);
    process.chdir(workspace);

    const allow = allowList(await sandboxConfig({}));

    assert.deepEqual(allow, [workspace, installed]);
  });

  it('resolves a relative Vite root from the working directory, as Vite does', async (t) => {
    setWorker(t, '1');
    const previous = process.cwd();
    // Registered before the workspace's cleanup, so the folder is no longer the working directory when it goes.
    t.after(() => process.chdir(previous));
    const { workspace, installed } = linkedWorkspace(t);
    mkdirSync(join(workspace, 'packages', 'app'), { recursive: true });
    writeFileSync(join(workspace, 'packages', 'app', 'package.json'), '{}');
    process.chdir(workspace);

    const allow = allowList(await sandboxConfig({ root: 'packages/app' }));

    assert.deepEqual(allow, [workspace, installed]);
  });

  it('takes the real path of a Vite root that is a link, as Vite does', async (t) => {
    setWorker(t, '1');
    const { workspace, installed } = linkedWorkspace(t);
    const link = join(dirname(workspace), 'link');
    symlinkSync(workspace, link, 'junction');

    const allow = allowList(await sandboxConfig({ root: link }));

    assert.deepEqual(allow, [workspace, installed]);
  });

  it('keeps a Vite root that is a link when the config preserves symlinks, as Vite does', async (t) => {
    setWorker(t, '1');
    const { workspace, installed } = linkedWorkspace(t);
    const link = join(dirname(workspace), 'link');
    symlinkSync(workspace, link, 'junction');

    const allow = allowList(
      await sandboxConfig({ root: link, resolve: { preserveSymlinks: true } }),
    );

    assert.deepEqual(allow, [link, installed]);
  });

  it("allows the workspace's linked node_modules when the Vite root is a package with none of its own", async (t) => {
    setWorker(t, '1');
    const { workspace, installed } = linkedWorkspace(t);
    const packageRoot = join(workspace, 'packages', 'app');
    mkdirSync(packageRoot, { recursive: true });
    writeFileSync(join(packageRoot, 'package.json'), '{}');

    const allow = allowList(await sandboxConfig({ root: packageRoot }));

    assert.ok(allow.includes(installed), `${installed} in ${allow.join(', ')}`);
  });
});
