// parseRoleTable on excerpts of playwright-core's bundle from 1.63.0 to the newest alpha, and consumerRoles against
// fake playwright-core installs on disk and against the installed one.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';

import { bundled } from '../src/bundled-roles.ts';
import { consumerRoles, parseRoleTable } from '../src/playwright-roles.ts';
import { exported } from './support/exports.ts';
import { excerpt, fakePlaywrightCore } from './support/fake-playwright-core.ts';

// tools/playwright-roles-matrix.ts writes one fixture per minor version of playwright-core.
const fixtureVersions = readdirSync(
  join(import.meta.dirname, 'fixture', 'roles'),
).map((file) => file.replace(/\.txt$/, ''));
const installedBundle = join(
  dirname(
    createRequire(import.meta.url).resolve('playwright-core/package.json'),
  ),
  'lib',
  'coreBundle.js',
);
const otherBundled = { version: '0.0.1', roles: new Map() };

describe('parseRoleTable', () => {
  it('has a fixture for the oldest supported playwright-core, 1.63.0', () => {
    assert.ok(fixtureVersions.includes('1.63.0'), String(fixtureVersions));
  });

  fixtureVersions.forEach((version) => {
    it(`reads the 53 entries of playwright-core ${version} whose role is constant or set by one attribute`, () => {
      const roles = parseRoleTable(excerpt(version));

      assert.equal(roles.size, 53);
      assert.deepEqual(roles.get('button'), { role: 'button' });
      assert.deepEqual(roles.get('a'), { role: 'link', attribute: 'href' });
      assert.deepEqual(roles.get('area'), {
        role: 'link',
        attribute: 'href',
      });
      assert.deepEqual(roles.get('sup'), { role: 'superscript' });
      assert.deepEqual(roles.get('svg'), { role: 'img' });
      assert.deepEqual(roles.get('ul'), { role: 'list' });
      assert.equal(roles.get('select'), undefined);
      assert.equal(roles.get('input'), undefined);
    });
  });

  it('reads an attribute entry whose function names its parameter with more than one letter', () => {
    const roles = parseRoleTable(
      'kImplicitRoleByTagName = {\\n  "AREA": (element) => {\\n    return element.hasAttribute("href") ? "link" : null;\\n  }\\n};',
    );

    assert.deepEqual(
      [...roles],
      [['area', { role: 'link', attribute: 'href' }]],
    );
  });

  it('reads no entry after the end of the table', () => {
    const roles = parseRoleTable(
      `${excerpt('1.64.1')}\\n  "SPAN": () => "generic",\\n`,
    );

    assert.equal(roles.get('span'), undefined);
  });

  (
    [
      [
        'the start of the table is missing',
        excerpt('1.64.1').replace('kImplicitRoleByTagName', 'kOther'),
        'kImplicitRoleByTagName not found',
      ],
      [
        'the end of the table is missing',
        excerpt('1.64.1').replace('\\n};', '\\n}'),
        'kImplicitRoleByTagName not found',
      ],
      [
        'no entry is constant or set by one attribute',
        'kImplicitRoleByTagName = {\\n  "INPUT": (e) => e.type\\n};',
        'kImplicitRoleByTagName has no entry whose role is constant or set by one attribute',
      ],
    ] as const
  ).forEach(([title, bundle, message]) => {
    it(`throws when ${title}`, () => {
      assert.throws(() => parseRoleTable(bundle), { message });
    });
  });
});

describe('the bundled table', () => {
  it('equals the table of the playwright-core this repository installs, so an upgrade fails here until generate-roles runs', () => {
    const manifest = readFileSync(
      join(installedBundle, '..', '..', 'package.json'),
      'utf8',
    );

    assert.deepEqual(
      bundled.roles,
      parseRoleTable(readFileSync(installedBundle, 'utf8')),
    );
    assert.equal(bundled.version, exported(JSON.parse(manifest), 'version'));
  });
});

describe('consumerRoles', () => {
  function recorder() {
    const messages: string[] = [];

    return { messages, warn: (message: string) => messages.push(message) };
  }

  it("reads the consumer's table, and warns about nothing", (t) => {
    const { resolve } = fakePlaywrightCore(t, '1.63.0', excerpt('1.63.0'));
    const { messages, warn } = recorder();

    const roles = consumerRoles(otherBundled, resolve, warn);

    assert.deepEqual(roles, parseRoleTable(excerpt('1.63.0')));
    assert.deepEqual(messages, []);
  });

  it('reads the table of the playwright-core that this package resolves by default', () => {
    assert.deepEqual(
      consumerRoles(otherBundled),
      parseRoleTable(readFileSync(installedBundle, 'utf8')),
    );
  });

  it('gives the bundled table, silently, when playwright-core is not installed', () => {
    const { messages, warn } = recorder();
    const notFound = () => {
      throw Object.assign(new Error('Cannot find module'), {
        code: 'MODULE_NOT_FOUND',
      });
    };

    assert.equal(
      consumerRoles(otherBundled, notFound, warn),
      otherBundled.roles,
    );
    assert.deepEqual(messages, []);
  });

  it('gives the bundled table, and warns once with the code and message, when resolving fails for another reason than a missing package', () => {
    const { messages, warn } = recorder();
    const notExported = () => {
      throw Object.assign(
        new Error("Package subpath './package.json' is not exported"),
        { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' },
      );
    };

    assert.equal(
      consumerRoles(otherBundled, notExported, warn),
      otherBundled.roles,
    );
    assert.deepEqual(messages, [
      'lz-stryker-ui-mutators: cannot read the implicit role table of playwright-core ' +
        "(Error: Package subpath './package.json' is not exported, code ERR_PACKAGE_PATH_NOT_EXPORTED); " +
        'LzElementRole uses the table bundled from playwright-core 0.0.1.',
    ]);
  });

  it('gives the bundled table, and warns once with the version, path and reason, when the table is unreadable', (t) => {
    const { resolve, bundlePath } = fakePlaywrightCore(
      t,
      '1.99.0',
      'export {};',
    );
    const { messages, warn } = recorder();

    assert.equal(
      consumerRoles(otherBundled, resolve, warn),
      otherBundled.roles,
    );
    assert.deepEqual(messages, [
      `lz-stryker-ui-mutators: cannot read the implicit role table of playwright-core 1.99.0 in ${bundlePath} ` +
        '(Error: kImplicitRoleByTagName not found); LzElementRole uses the table bundled from playwright-core 0.0.1.',
    ]);
  });
});
