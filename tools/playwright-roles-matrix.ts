// Refreshes ui-mutators' role-table fixtures, packages/lz-stryker-ui-mutators/test/fixture/roles/<version>.txt: one
// per minor version of playwright-core from 1.63.0, the oldest the span swap supports, to the registry's `latest`,
// each from that minor's newest patch. A fixture is the kImplicitRoleByTagName excerpt of lib/coreBundle.js, escaped
// as in the bundle. It downloads each tarball from registry.npmjs.org and unpacks only that file with `tar`, so it
// runs no package manager. Run it when a Playwright minor ships, then run the ui-mutators tests: a new fixture that
// the parser cannot read fails them. Existing fixtures for other versions stay.
// Run: node tools/playwright-roles-matrix.ts [download parent dir, default the OS temp dir]
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const oldestMinor = 63;
const start = 'kImplicitRoleByTagName = {';
const end = '\\n};';
const fixtures = path.join(
  import.meta.dirname,
  '..',
  'packages',
  'lz-stryker-ui-mutators',
  'test',
  'fixture',
  'roles',
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function tarballOf(versions: Record<string, unknown>, version: string): string {
  const entry = versions[version];
  const dist = isRecord(entry) ? entry['dist'] : undefined;
  const tarball = isRecord(dist) ? dist['tarball'] : undefined;

  if (typeof tarball !== 'string') {
    throw new Error(`playwright-core ${version} has no dist.tarball`);
  }

  return tarball;
}

const response = await fetch('https://registry.npmjs.org/playwright-core', {
  headers: { accept: 'application/vnd.npm.install-v1+json' },
});

if (!response.ok) {
  throw new Error(`registry.npmjs.org answered ${String(response.status)}`);
}

const metadata: unknown = await response.json();
const versions = isRecord(metadata) ? metadata['versions'] : undefined;
const tags = isRecord(metadata) ? metadata['dist-tags'] : undefined;
const latest = isRecord(tags) ? tags['latest'] : undefined;

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
    const from = bundle.indexOf(start);
    const to = bundle.indexOf(end, from);

    if (from === -1 || to === -1) {
      throw new Error(
        `playwright-core ${version} has no kImplicitRoleByTagName`,
      );
    }

    writeFileSync(
      path.join(fixtures, `${version}.txt`),
      `${bundle.slice(from, to + end.length)}\n`,
    );
    console.log(`${version}: ${String(to + end.length - from)} characters`);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
