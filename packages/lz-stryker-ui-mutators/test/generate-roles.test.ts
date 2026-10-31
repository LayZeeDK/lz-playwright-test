import assert from 'node:assert/strict';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, it } from 'node:test';

import { generateRoles } from '../scripts/roles-generator.ts';
import { parseRoleTable } from '../src/playwright-roles.ts';
import { exported } from './support/exports.ts';
import {
  buttonOnly,
  excerpt,
  fakePlaywrightCore,
} from './support/fake-playwright-core.ts';
import { tempRoot } from './support/temp-tree.ts';

function paths(root: string) {
  return { from: join(root, 'index.js'), out: join(root, 'bundled-roles.mts') };
}

describe('generateRoles', () => {
  it('writes the table and version of the playwright-core it resolves as the bundled table', async (t) => {
    const { root } = fakePlaywrightCore(t, '1.63.0', excerpt('1.63.0'));
    const { from, out } = paths(root);

    generateRoles(from, out);

    assert.deepEqual(
      exported(await import(pathToFileURL(out).href), 'bundled'),
      { version: '1.63.0', roles: parseRoleTable(excerpt('1.63.0')) },
    );
  });

  it('throws naming the version, the path and what is missing, and writes nothing, when the table is unreadable', (t) => {
    const { root, bundlePath } = fakePlaywrightCore(t, '1.99.0', 'export {};');
    const { from, out } = paths(root);

    assert.throws(() => generateRoles(from, out), {
      message: `cannot read the implicit role table of playwright-core 1.99.0 in ${bundlePath} (Error: kImplicitRoleByTagName not found)`,
    });
    assert.equal(existsSync(out), false);
  });

  it('throws naming the missing tags, and writes nothing, when the table lacks entries LzElementRole reads', (t) => {
    const { root, bundlePath } = fakePlaywrightCore(t, '1.99.0', buttonOnly);
    const { from, out } = paths(root);

    assert.throws(() => generateRoles(from, out), {
      message: `cannot read the implicit role table of playwright-core 1.99.0 in ${bundlePath} (Error: kImplicitRoleByTagName lacks the entries for a, area that LzElementRole reads)`,
    });
    assert.equal(existsSync(out), false);
  });

  it('throws, and writes nothing, when resolving playwright-core fails for another reason', (t) => {
    const { root, manifestPath } = fakePlaywrightCore(
      t,
      '1.99.0',
      excerpt('1.64.1'),
    );
    const { from, out } = paths(root);
    writeFileSync(
      manifestPath,
      JSON.stringify({ name: 'playwright-core', exports: { '.': './x.js' } }),
    );

    assert.throws(() => generateRoles(from, out), {
      message:
        /^cannot resolve playwright-core from .+index\.js: Package subpath '\.\/package\.json' is not defined by "exports" in .+\.$/,
    });
    assert.equal(existsSync(out), false);
  });

  it('throws, and writes nothing, when playwright-core is not installed', (t) => {
    const root = tempRoot(t, 'ui-mutators-pw-');
    const { from, out } = paths(root);

    assert.throws(() => generateRoles(from, out), {
      message: `playwright-core is not installed where ${from} resolves it; it is a dev dependency of this package.`,
    });
    assert.equal(existsSync(out), false);
  });
});
