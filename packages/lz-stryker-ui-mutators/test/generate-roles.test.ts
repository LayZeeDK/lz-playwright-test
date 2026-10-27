// scripts/generate-roles.ts in a child `node` process, against fake playwright-core installs, writing to a temp file.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, it } from 'node:test';

import { parseRoleTable } from '../src/playwright-roles.ts';
import { exported } from './support/exports.ts';
import {
  excerpt,
  fakePlaywrightCore,
  tempRoot,
} from './support/fake-playwright-core.ts';

const script = join(import.meta.dirname, '..', 'scripts', 'generate-roles.ts');

/** Runs the generator with playwright-core resolved from `root`, writing to `root`/bundled-roles.mts. */
function generate(root: string) {
  // .mts, so Node.js loads it as a module without a package.json that says so.
  const out = join(root, 'bundled-roles.mts');
  const child = spawnSync(process.execPath, [script], {
    encoding: 'utf8',
    env: {
      ...process.env,
      LZ_UI_MUTATORS_ROLES_FROM: join(root, 'index.js'),
      LZ_UI_MUTATORS_ROLES_OUT: out,
    },
  });

  return { status: child.status, stderr: child.stderr, out };
}

describe('generate-roles', () => {
  it('writes the table and version of the playwright-core it resolves as the bundled table', async (t) => {
    const { root } = fakePlaywrightCore(t, '1.63.0', excerpt('1.63.0'));

    const { status, stderr, out } = generate(root);

    assert.equal(status, 0, stderr);
    assert.equal(stderr, '');
    assert.deepEqual(
      exported(await import(pathToFileURL(out).href), 'bundled'),
      { version: '1.63.0', roles: parseRoleTable(excerpt('1.63.0')) },
    );
  });

  it('exits 1 with one line naming the version, the path and what is missing, and writes nothing, when the table is unreadable', (t) => {
    const { root, bundlePath } = fakePlaywrightCore(t, '1.99.0', 'export {};');

    const { status, stderr, out } = generate(root);

    assert.equal(status, 1);
    assert.equal(
      stderr,
      `lz-stryker-ui-mutators build: cannot read the implicit role table of playwright-core 1.99.0 in ${bundlePath}: kImplicitRoleByTagName not found.\n`,
    );
    assert.equal(existsSync(out), false);
  });

  it('exits 1 with one line, and writes nothing, when resolving playwright-core fails for another reason', (t) => {
    const { root } = fakePlaywrightCore(t, '1.99.0', excerpt('1.64.1'));
    writeFileSync(
      join(root, 'node_modules', 'playwright-core', 'package.json'),
      JSON.stringify({ name: 'playwright-core', exports: { '.': './x.js' } }),
    );

    const { status, stderr, out } = generate(root);

    assert.equal(status, 1);
    assert.match(
      stderr,
      /^lz-stryker-ui-mutators build: cannot resolve playwright-core from .+index\.js: Package subpath '\.\/package\.json' is not defined by "exports" in .+\.\n$/,
    );
    assert.equal(existsSync(out), false);
  });

  it('exits 1 with one line, and writes nothing, when playwright-core is not installed', (t) => {
    const root = tempRoot(t);

    const { status, stderr, out } = generate(root);

    assert.equal(status, 1);
    assert.equal(
      stderr,
      `lz-stryker-ui-mutators build: playwright-core is not installed where ${join(root, 'index.js')} resolves it; it is a dev dependency of this package.\n`,
    );
    assert.equal(existsSync(out), false);
  });
});
