import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import type { ImplicitRole, RoleTable } from '../../src/implicit-roles.ts';
import { fieldOf, isRecord } from '../../src/is-record.ts';

const require = createRequire(import.meta.url);

const start = 'kImplicitRoleByTagName = {';
// The table sits in playwright-core/lib/coreBundle.js inside one string literal, so its line breaks are the two
// characters `\n`. An entry is a line indented by two spaces; deeper lines belong to an entry's function body.
const end = '\\n};';
const always = /\\n {2}"(\w+)": \(\) => "(\w+)",?(?=\\n)/g;
const withAttribute =
  /\\n {2}"(\w+)": \(\w+\) => \{\\n {4}return \w+\.hasAttribute\("(\w+)"\) \? "(\w+)" : null;\\n {2}\}/g;

function captured(value: string | undefined): string {
  if (value === undefined) {
    throw new Error('a role table pattern matched without its group');
  }

  return value;
}

/** The tags the installed playwright-core gives a role by tag alone, or by tag and one attribute. */
export function playwrightRoles(): RoleTable {
  const manifest = require.resolve('playwright-core/package.json');
  const bundle = readFileSync(
    join(dirname(manifest), 'lib', 'coreBundle.js'),
    'utf8',
  );
  const from = bundle.indexOf(start);
  const to = bundle.indexOf(end, from);

  if (from === -1 || to === -1) {
    throw new Error(`kImplicitRoleByTagName not found in ${manifest}`);
  }

  const table = bundle.slice(from, to + end.length);

  return new Map([
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
}

interface Concept {
  readonly name: string;
  readonly attributes: readonly string[];
  readonly roles: readonly string[];
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function conceptOf(entry: unknown): Concept {
  if (!Array.isArray(entry)) {
    throw new Error('an aria-query elementRoles entry is not a pair');
  }

  const concept: unknown = entry[0];
  const roleList: unknown = entry[1];
  const name = fieldOf(concept, 'name');
  const attributes = fieldOf(concept, 'attributes') ?? [];
  // aria-query 5.3.0 holds the roles in an array, 5.3.2 in a Set.
  const roles: unknown = roleList instanceof Set ? [...roleList] : roleList;

  if (!isString(name) || !Array.isArray(attributes) || !Array.isArray(roles)) {
    throw new Error('an aria-query elementRoles entry has an unknown shape');
  }

  return {
    name,
    attributes: attributes
      .map((attribute: unknown) => fieldOf(attribute, 'name'))
      .filter(isString),
    roles: roles.filter(isString),
  };
}

/** aria-query's element concepts, the ones Testing Library's `getByRole` matches by name and attributes. */
export function ariaQueryConcepts(): readonly Concept[] {
  const ariaQuery: unknown = require('aria-query');
  const elementRoles = fieldOf(ariaQuery, 'elementRoles');
  const entries = fieldOf(elementRoles, 'entries');

  if (!isRecord(elementRoles) || typeof entries !== 'function') {
    throw new Error('aria-query has no elementRoles.entries()');
  }

  const list: unknown = Reflect.apply(entries, elementRoles, []);

  if (!Array.isArray(list)) {
    throw new Error('aria-query elementRoles.entries() is not an array');
  }

  return list.map(conceptOf);
}

/**
 * Whether aria-query gives `tag` the role: by tag alone when the entry needs no attribute, else with that
 * attribute. Like Testing Library, it ignores a concept's constraints (such as `li` in a list).
 */
export function ariaQueryGives(
  concepts: readonly Concept[],
  tag: string,
  { role, requiredAttribute }: ImplicitRole,
): boolean {
  return concepts.some(
    (concept) =>
      concept.name === tag &&
      concept.roles.includes(role) &&
      (requiredAttribute === undefined
        ? concept.attributes.length === 0
        : concept.attributes.includes(requiredAttribute)),
  );
}
