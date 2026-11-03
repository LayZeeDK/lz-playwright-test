import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import type { TestContext } from 'node:test';

import { tempRoot, writeTree } from './temp-tree.ts';

export function fakePlaywrightCore(
  t: TestContext,
  version: string,
  bundle: string,
) {
  const root = tempRoot(t, 'ui-mutators-pw-');
  const dir = join(root, 'node_modules', 'playwright-core');
  writeTree(dir, {
    'package.json': JSON.stringify({ name: 'playwright-core', version }),
    'lib/coreBundle.js': bundle,
  });

  return {
    root,
    resolve: createRequire(join(root, 'index.js')).resolve,
    manifestPath: join(dir, 'package.json'),
    bundlePath: join(dir, 'lib', 'coreBundle.js'),
  };
}

export const buttonOnly =
  'kImplicitRoleByTagName = {\\n  "BUTTON": () => "button"\\n};';

export function excerpt(version: string): string {
  return readFileSync(
    join(import.meta.dirname, '..', 'fixture', 'roles', `${version}.txt`),
    'utf8',
  );
}
