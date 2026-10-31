import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { fieldOf, isRecord } from '../src/is-record.ts';
import { roleTableExcerpt } from '../src/playwright-roles.ts';

const oldestMinor = 63;
const fixtures = path.join(
  import.meta.dirname,
  '..',
  'test',
  'fixture',
  'roles',
);

function tarballOf(versions: Record<string, unknown>, version: string): string {
  const tarball = fieldOf(fieldOf(versions[version], 'dist'), 'tarball');

  if (typeof tarball !== 'string') {
    throw new Error(`playwright-core ${version} has no dist.tarball`);
  }

  return tarball;
}

function excerptOf(bundle: string, version: string): string {
  try {
    return roleTableExcerpt(bundle);
  } catch (error) {
    throw new Error(
      `playwright-core ${version} has no kImplicitRoleByTagName`,
      {
        cause: error,
      },
    );
  }
}

const response = await fetch('https://registry.npmjs.org/playwright-core', {
  headers: { accept: 'application/vnd.npm.install-v1+json' },
});

if (!response.ok) {
  throw new Error(`registry.npmjs.org answered ${String(response.status)}`);
}

const metadata: unknown = await response.json();
const versions = fieldOf(metadata, 'versions');
const latest = fieldOf(fieldOf(metadata, 'dist-tags'), 'latest');

if (!isRecord(versions) || typeof latest !== 'string') {
  throw new Error('the playwright-core metadata has no versions or no latest');
}

const latestMinor = Number(latest.split('.')[1]);
const newestPatch = new Map<number, number>();

Object.keys(versions).forEach((version) => {
  const match = /^1\.(\d+)\.(\d+)$/.exec(version);

  if (match === null) {
    return;
  }

  const minor = Number(match[1]);
  const patch = Number(match[2]);

  if (
    minor >= oldestMinor &&
    minor <= latestMinor &&
    patch >= (newestPatch.get(minor) ?? -1)
  ) {
    newestPatch.set(minor, patch);
  }
});

const work = mkdtempSync(path.join(process.argv[2] ?? tmpdir(), 'pw-roles-'));

try {
  for (const [minor, patch] of [...newestPatch].sort(([a], [b]) => a - b)) {
    const version = `1.${String(minor)}.${String(patch)}`;
    const download = await fetch(tarballOf(versions, version));

    if (!download.ok) {
      throw new Error(
        `the playwright-core ${version} tarball answered ${String(download.status)}`,
      );
    }

    writeFileSync(
      path.join(work, `${version}.tgz`),
      Buffer.from(await download.arrayBuffer()),
    );
    // A relative path, because Git Bash's GNU tar reads `D:` in an absolute one as a remote host.
    execFileSync(
      'tar',
      ['-xzf', `${version}.tgz`, 'package/lib/coreBundle.js'],
      {
        cwd: work,
      },
    );
    const bundle = readFileSync(
      path.join(work, 'package', 'lib', 'coreBundle.js'),
      'utf8',
    );
    const excerpt = excerptOf(bundle, version);

    writeFileSync(path.join(fixtures, `${version}.txt`), `${excerpt}\n`);
    console.log(`${version}: ${String(excerpt.length)} characters`);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
