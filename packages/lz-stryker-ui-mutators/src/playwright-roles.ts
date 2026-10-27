import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import { fieldOf } from './install.ts';

export interface ImplicitRole {
  readonly role: string;
  /** The element has the role only while it has this attribute. */
  readonly attribute?: string;
}

/** Keyed by lowercase tag name; `undefined` is the name of a JSX element that is not a plain identifier. */
export type RoleTable = ReadonlyMap<string | undefined, ImplicitRole>;

export interface BundledRoles {
  readonly version: string;
  readonly roles: RoleTable;
}

export interface PlaywrightCore {
  readonly version: string;
  /** The path of lib/coreBundle.js, which holds the role table. */
  readonly bundlePath: string;
}

/**
 * The playwright-core that `resolve` finds, or undefined when it finds none. Throws when resolving fails for another
 * reason, such as a subpath its `exports` leave out.
 */
export function findPlaywrightCore(
  resolve: (specifier: string) => string,
): PlaywrightCore | undefined {
  let manifest: string;

  try {
    manifest = resolve('playwright-core/package.json');
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

  return {
    version: String(
      fieldOf(JSON.parse(readFileSync(manifest, 'utf8')), 'version'),
    ),
    bundlePath: join(dirname(manifest), 'lib', 'coreBundle.js'),
  };
}

/**
 * The role table of the playwright-core this package resolves (a peer dependency, so the consumer's), else the
 * bundled table. Only a missing playwright-core is silent: every other failure warns once through `warn`, with the
 * version, path, error and its code as far as they are known, and gives the bundled table.
 */
export function consumerRoles(
  bundled: BundledRoles,
  resolve: (specifier: string) => string = createRequire(import.meta.url)
    .resolve,
  warn: (message: string) => void = console.warn,
): RoleTable {
  let core: PlaywrightCore | undefined;

  try {
    core = findPlaywrightCore(resolve);

    return core === undefined
      ? bundled.roles
      : parseRoleTable(readFileSync(core.bundlePath, 'utf8'));
  } catch (error) {
    const code = fieldOf(error, 'code');
    const found =
      core === undefined ? '' : ` ${core.version} in ${core.bundlePath}`;
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

const start = 'kImplicitRoleByTagName = {';
// The table sits in playwright-core/lib/coreBundle.js inside one string literal, so its line breaks are the two
// characters `\n`. An entry is a line indented by two spaces; deeper lines belong to an entry's function body.
const end = '\\n};';
const always = /\\n {2}"(\w+)": \(\) => "(\w+)",?(?=\\n)/g;
const withAttribute =
  /\\n {2}"(\w+)": \(\w+\) => \{\\n {4}return \w+\.hasAttribute\("(\w+)"\) \? "(\w+)" : null;\\n {2}\}/g;

/**
 * The entries of Playwright's `kImplicitRoleByTagName` whose role is constant or depends on one attribute, read from
 * the text of playwright-core/lib/coreBundle.js. Entries whose role depends on more are left out. Throws when the table
 * is missing or none of its entries has either shape.
 */
export function parseRoleTable(bundle: string): RoleTable {
  const from = bundle.indexOf(start);
  const to = bundle.indexOf(end, from);

  if (from === -1 || to === -1) {
    throw new Error('kImplicitRoleByTagName not found');
  }

  const table = bundle.slice(from, to + end.length);
  const roles: RoleTable = new Map([
    ...[...table.matchAll(always)].flatMap(([, tag, role]) =>
      tag === undefined || role === undefined
        ? []
        : [[tag.toLowerCase(), { role }] as const],
    ),
    ...[...table.matchAll(withAttribute)].flatMap(([, tag, attribute, role]) =>
      tag === undefined || attribute === undefined || role === undefined
        ? []
        : [[tag.toLowerCase(), { role, attribute }] as const],
    ),
  ]);

  if (roles.size === 0) {
    throw new Error(
      'kImplicitRoleByTagName has no entry whose role is constant or set by one attribute',
    );
  }

  return roles;
}
