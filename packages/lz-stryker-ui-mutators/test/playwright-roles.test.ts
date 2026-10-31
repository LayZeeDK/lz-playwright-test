// parseRoleTable on excerpts of playwright-core's bundle from 1.63.0 to the newest alpha, and consumerRoles against
// fake playwright-core installs on disk and against the installed one.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';

import { bundled } from '../src/bundled-roles.ts';
import {
  consumerRoles,
  parseRoleTable,
  type BundledRoles,
} from '../src/playwright-roles.ts';
import { exported } from './support/exports.ts';
import {
  buttonOnly,
  excerpt,
  fakePlaywrightCore,
} from './support/fake-playwright-core.ts';
import { tempRoot } from './support/temp-tree.ts';

// tools/playwright-roles-matrix.ts writes one fixture per minor version of playwright-core.
const fixtureVersions = readdirSync(
  join(import.meta.dirname, 'fixture', 'roles'),
).map((file) => file.replace(/\.txt$/, ''));
const installedManifest = createRequire(import.meta.url).resolve(
  'playwright-core/package.json',
);
const installedBundle = join(
  dirname(installedManifest),
  'lib',
  'coreBundle.js',
);
const otherBundled: BundledRoles = { version: '0.0.1', roles: new Map() };

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
      'kImplicitRoleByTagName = {\\n  "A": (e) => {\\n    return e.hasAttribute("href") ? "link" : null;\\n  },' +
        '\\n  "AREA": (element) => {\\n    return element.hasAttribute("href") ? "link" : null;\\n  },' +
        '\\n  "BUTTON": () => "button"\\n};',
    );

    assert.deepEqual(
      [...roles],
      [
        ['button', { role: 'button' }],
        ['a', { role: 'link', attribute: 'href' }],
        ['area', { role: 'link', attribute: 'href' }],
      ],
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
        'kImplicitRoleByTagName lacks the entries for a, area, button that LzElementRole reads',
      ],
      [
        'the table lacks some of the entries that LzElementRole reads',
        buttonOnly,
        'kImplicitRoleByTagName lacks the entries for a, area that LzElementRole reads',
      ],
      [
        'the table lacks only the BUTTON entry',
        excerpt('1.64.1').replace(
          '"BUTTON": () => "button"',
          '"BUTTON": (e) => e.type',
        ),
        'kImplicitRoleByTagName lacks the entries for button that LzElementRole reads',
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
    const manifest = readFileSync(installedManifest, 'utf8');

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

  it('gives the bundled table, and warns once naming the missing tags, when the table lacks entries LzElementRole reads', (t) => {
    const { resolve, bundlePath } = fakePlaywrightCore(t, '1.99.0', buttonOnly);
    const { messages, warn } = recorder();

    assert.equal(
      consumerRoles(otherBundled, resolve, warn),
      otherBundled.roles,
    );
    assert.deepEqual(messages, [
      `lz-stryker-ui-mutators: cannot read the implicit role table of playwright-core 1.99.0 in ${bundlePath} ` +
        '(Error: kImplicitRoleByTagName lacks the entries for a, area that LzElementRole reads); ' +
        'LzElementRole uses the table bundled from playwright-core 0.0.1.',
    ]);
  });

  // Node.js's own resolver rejects a package.json that is not JSON, so a custom resolve stands in for one that does not.
  it('gives the bundled table, and warns once with the manifest path and reason, when the manifest is not JSON', (t) => {
    const manifest = join(tempRoot(t, 'ui-mutators-pw-'), 'package.json');
    writeFileSync(manifest, '{');
    const resolve = () => manifest;
    const { messages, warn } = recorder();
    // Node.js words the JSON error differently across versions.
    const jsonError = (() => {
      try {
        JSON.parse('{');
      } catch (error) {
        return error;
      }

      return undefined;
    })();

    assert.equal(
      consumerRoles(otherBundled, resolve, warn),
      otherBundled.roles,
    );
    assert.deepEqual(messages, [
      `lz-stryker-ui-mutators: cannot read the implicit role table of playwright-core in ${manifest} ` +
        `(${String(jsonError)}); LzElementRole uses the table bundled from playwright-core 0.0.1.`,
    ]);
  });
});
