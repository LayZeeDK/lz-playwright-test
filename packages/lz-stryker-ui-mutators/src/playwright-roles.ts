import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import { fieldOf } from './is-record.ts';
import { spanSwapRoleByTag } from './span-swap.ts';

export interface ImplicitRole {
  readonly role: string;
  readonly requiredAttribute?: string;
}

/** Keyed by lowercase tag name. */
export type RoleTable = ReadonlyMap<string, ImplicitRole>;

export interface BundledRoles {
  readonly version: string;
  readonly roles: RoleTable;
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

export function readRoleTable(manifest: string): BundledRoles {
  const version = unreadable(['in', manifest], () =>
    String(fieldOf(JSON.parse(readFileSync(manifest, 'utf8')), 'version')),
  );
  const bundlePath = join(dirname(manifest), 'lib', 'coreBundle.js');
  const roles = unreadable([version, 'in', bundlePath], () =>
    parseRoleTable(readFileSync(bundlePath, 'utf8')),
  );

  return { version, roles };
}

class RoleTableError extends Error {}

function unreadable<T>(where: readonly string[], step: () => T): T {
  try {
    return step();
  } catch (error) {
    const reason =
      error instanceof Error && 'code' in error
        ? `${String(error)}, code ${String(error.code)}`
        : String(error);

    throw new RoleTableError(
      `${['cannot read the implicit role table of playwright-core', ...where].join(' ')} (${reason})`,
      { cause: error },
    );
  }
}

export function consumerRoles(
  bundled: BundledRoles,
  resolve: (specifier: string) => string = createRequire(import.meta.url)
    .resolve,
  warn: (message: string) => void = console.warn,
): RoleTable {
  try {
    const manifest = unreadable([], () => findManifest(resolve));

    return manifest === undefined
      ? bundled.roles
      : readRoleTable(manifest).roles;
  } catch (error) {
    if (!(error instanceof RoleTableError)) {
      throw error;
    }

    warn(
      `lz-stryker-ui-mutators: ${error.message}; ` +
        `LzElementRole uses the table bundled from playwright-core ${bundled.version}.`,
    );

    return bundled.roles;
  }
}

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

  const missing: string[] = [];
  const changed: string[] = [];

  for (const [tag, expected] of spanSwapRoleByTag) {
    const found = roles.get(tag)?.role;

    if (found === undefined) {
      missing.push(tag);
    } else if (found !== expected) {
      changed.push(`${tag} is ${found}, not ${expected}`);
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `kImplicitRoleByTagName lacks the entries for ${missing.join(', ')} that LzElementRole reads`,
    );
  }

  if (changed.length > 0) {
    throw new Error(
      `kImplicitRoleByTagName changes the roles LzElementRole reads: ${changed.join('; ')}`,
    );
  }

  return roles;
}
