import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { TestContext } from 'node:test';

export function tempRoot(t: TestContext, prefix: string): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  return root;
}

export function writeTree(
  dir: string,
  files: Readonly<Record<string, string>>,
): void {
  Object.entries(files).forEach(([file, content]) => {
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    writeFileSync(join(dir, file), content);
  });
}
