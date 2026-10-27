import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from 'node:test';

/** A directory that `t` removes after the test. */
export function tempRoot(t: TestContext): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'ui-mutators-pw-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  return root;
}

/** A playwright-core `version` whose lib/coreBundle.js holds `bundle`, under a directory `t` removes; its resolve. */
export function fakePlaywrightCore(
  t: TestContext,
  version: string,
  bundle: string,
) {
  const root = tempRoot(t);
  const dir = join(root, 'node_modules', 'playwright-core');
  mkdirSync(join(dir, 'lib'), { recursive: true });
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'playwright-core', version }),
  );
  writeFileSync(join(dir, 'lib', 'coreBundle.js'), bundle);

  return {
    root,
    resolve: createRequire(join(root, 'index.js')).resolve,
    bundlePath: join(dir, 'lib', 'coreBundle.js'),
  };
}

/** The kImplicitRoleByTagName excerpt of playwright-core/lib/coreBundle.js at `version`, escaped as in the bundle. */
export function excerpt(version: string): string {
  return readFileSync(
    join(import.meta.dirname, '..', 'fixture', 'roles', `${version}.txt`),
    'utf8',
  );
}
