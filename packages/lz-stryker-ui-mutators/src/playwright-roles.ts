import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import { fieldOf } from './is-record.ts';

export interface ImplicitRole {
  readonly role: string;
  readonly requiredAttribute?: string;
}

/** Keyed by lowercase tag name; `undefined` is the name of a JSX element that is not a plain identifier. */
export type RoleTable = ReadonlyMap<string | undefined, ImplicitRole>;

export interface BundledRoles {
  readonly version: string;
  readonly roles: RoleTable;
}

export interface PlaywrightCore {
  readonly version: string;
  readonly bundlePath: string;
}

export function findManifest(
  resolve: (specifier: string) => string,
): string | undefined {
  try {
    return resolve('playwright-core/package.json');
  } catch (error) {
    if (
      error instanceof Error &&
      'code' in error &&
      error.code === 'MODULE_NOT_FOUND'
    ) {
      return undefined;
    }

    throw error;
  }
}

export function readPlaywrightCore(manifest: string): PlaywrightCore {
  return {
    version: String(
      fieldOf(JSON.parse(readFileSync(manifest, 'utf8')), 'version'),
    ),
    bundlePath: join(dirname(manifest), 'lib', 'coreBundle.js'),
  };
}

export function consumerRoles(
  bundled: BundledRoles,
  resolve: (specifier: string) => string = createRequire(import.meta.url)
    .resolve,
  warn: (message: string) => void = console.warn,
): RoleTable {
  let found = '';

  try {
    const manifest = findManifest(resolve);

    if (manifest === undefined) {
      return bundled.roles;
    }

    found = ` in ${manifest}`;
    const core = readPlaywrightCore(manifest);
    found = ` ${core.version} in ${core.bundlePath}`;

    return parseRoleTable(readFileSync(core.bundlePath, 'utf8'));
  } catch (error) {
    const code = fieldOf(error, 'code');
    const reason =
      code === undefined
        ? String(error)
        : `${String(error)}, code ${String(code)}`;

    warn(
      `lz-stryker-ui-mutators: cannot read the implicit role table of playwright-core${found} (${reason}); ` +
        `LzElementRole uses the table bundled from playwright-core ${bundled.version}.`,
    );

    return bundled.roles;
  }
}

const spanSwapTags: readonly string[] = ['a', 'area', 'button'];
const start = 'kImplicitRoleByTagName = {';
// The table sits in playwright-core/lib/coreBundle.js inside one string literal, so its line breaks are the two
// characters `\n`. An entry is a line indented by two spaces; deeper lines belong to an entry's function body.
const end = '\\n};';
const always = /\\n {2}"(\w+)": \(\) => "(\w+)",?(?=\\n)/g;
const withAttribute =
  /\\n {2}"(\w+)": \(\w+\) => \{\\n {4}return \w+\.hasAttribute\("(\w+)"\) \? "(\w+)" : null;\\n {2}\}/g;

function captured(value: string | undefined): string {
  if (value === undefined) {
    throw new Error();
  }

  return value;
}

export function roleTableExcerpt(bundle: string): string {
  const from = bundle.indexOf(start);
  const to = bundle.indexOf(end, from);

  if (from === -1 || to === -1) {
    throw new Error('kImplicitRoleByTagName not found');
  }

  return bundle.slice(from, to + end.length);
}

export function parseRoleTable(bundle: string): RoleTable {
  const table = roleTableExcerpt(bundle);
  const roles: RoleTable = new Map([
    ...[...table.matchAll(always)].map(
      ([, tag, role]) =>
        [captured(tag).toLowerCase(), { role: captured(role) }] as const,
    ),
    ...[...table.matchAll(withAttribute)].map(
      ([, tag, attribute, role]) =>
        [
          captured(tag).toLowerCase(),
          { role: captured(role), requiredAttribute: captured(attribute) },
        ] as const,
    ),
  ]);

  const missing = spanSwapTags.filter((tag) => !roles.has(tag));

  if (missing.length > 0) {
    throw new Error(
      `kImplicitRoleByTagName lacks the entries for ${missing.join(', ')} that LzElementRole reads`,
    );
  }

  return roles;
}
