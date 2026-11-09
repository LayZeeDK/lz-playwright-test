import { fieldOf, isRecord } from '@layzee/stryker-mutator-install';

import type { LzPlaywrightMutator } from './mutators.ts';

/** A literal that a mutator may swap: the node, and the value that tells it from another literal of the same key. */
export interface Site {
  readonly key: string;
  readonly value: string;
  readonly node: unknown;
}

/** Reads the site of a call expression, when the call has one. */
export type SiteReader = (call: unknown) => Site | undefined;

/** True when two site values must never replace each other. */
type Excludes = (one: string, other: string) => boolean;

export function swapMutator<const TName extends string>(
  name: TName,
  sample: string,
  read: SiteReader,
  excludes: Excludes = (one, other) => one === other,
): LzPlaywrightMutator & { readonly name: TName } {
  const indexed = new WeakMap<
    object,
    ReadonlyMap<unknown, readonly unknown[]>
  >();

  return {
    name,
    sample,
    *mutate(path, t) {
      const program = programOf(path);

      if (!isRecord(program)) {
        return;
      }

      // Built on the first node Stryker shows of this file: Program for a whole file, the first node inside the
      // range for a line range. Either way no mutant has been placed in the file yet.
      const known = indexed.get(program);
      const replacements =
        known ?? replacementsBySite(callsOf(program).map(read), excludes);

      if (known === undefined) {
        indexed.set(program, replacements);
      }

      yield* (replacements.get(fieldOf(path, 'node')) ?? []).map(
        (replacement) => t.cloneNode(replacement),
      );
    },
  };
}

function replacementsBySite(
  found: readonly (Site | undefined)[],
  excludes: Excludes,
): ReadonlyMap<unknown, readonly unknown[]> {
  const sites = found
    .filter((site) => site !== undefined)
    .toSorted((one, other) => startOf(one.node) - startOf(other.node));

  return new Map(
    sites.map((site, index) => [
      site.node,
      [
        sites.slice(0, index).findLast(isReplacementFor(site, excludes)),
        sites.slice(index + 1).find(isReplacementFor(site, excludes)),
      ]
        .filter((neighbour) => neighbour !== undefined)
        .filter(
          (neighbour, at, all) =>
            all.findIndex(({ value }) => excludes(value, neighbour.value)) ===
            at,
        )
        .map((neighbour) => neighbour.node),
    ]),
  );
}

function startOf(node: unknown): number {
  const start = fieldOf(node, 'start');

  return typeof start === 'number' ? start : 0;
}

function isReplacementFor(
  site: Site,
  excludes: Excludes,
): (other: Site) => boolean {
  return ({ key, value }) => key === site.key && !excludes(value, site.value);
}

function programOf(path: unknown): unknown {
  return fieldOf(
    fieldOf(fieldOf(fieldOf(path, 'hub'), 'file'), 'ast'),
    'program',
  );
}

const callLists = new WeakMap<object, readonly unknown[]>();

/** The calls of a file in the order of the walk, read once for every mutator that asks. */
function callsOf(program: object): readonly unknown[] {
  const known = callLists.get(program);
  const calls = known ?? callsIn(program);

  callLists.set(program, calls);

  return calls;
}

export const callTypes: readonly unknown[] = [
  'CallExpression',
  'OptionalCallExpression',
];
export const memberTypes: readonly unknown[] = [
  'MemberExpression',
  'OptionalMemberExpression',
];

function callsIn(node: unknown): readonly unknown[] {
  const children: readonly unknown[] = isRecord(node)
    ? Object.values(node).flatMap((value): readonly unknown[] =>
        Array.isArray(value) ? value : [value],
      )
    : [];

  return [
    ...(callTypes.includes(fieldOf(node, 'type')) ? [node] : []),
    ...children
      .filter((child) => typeof fieldOf(child, 'type') === 'string')
      .flatMap(callsIn),
  ];
}

function methodOf(call: unknown): unknown {
  const callee = fieldOf(call, 'callee');

  return memberTypes.includes(fieldOf(callee, 'type')) &&
    fieldOf(callee, 'computed') === false
    ? fieldOf(fieldOf(callee, 'property'), 'name')
    : undefined;
}

function argumentOf(call: unknown, index: number): unknown {
  const args = fieldOf(call, 'arguments');

  return Array.isArray(args) ? args[index] : undefined;
}

/**
 * What tells two locator values apart: a string literal and an expression-free template literal by their text, a
 * regex literal by pattern and flags. A string and a regex never compare equal.
 */
function valueOf(node: unknown): string | undefined {
  switch (fieldOf(node, 'type')) {
    case 'StringLiteral':
    case 'TemplateLiteral': {
      const text = textOf(node);

      return text === undefined ? undefined : `string:${text}`;
    }
    case 'RegExpLiteral': {
      const pattern = fieldOf(node, 'pattern');
      const flags = fieldOf(node, 'flags');

      return typeof pattern === 'string' && typeof flags === 'string'
        ? `regex:/${pattern}/${flags}`
        : undefined;
    }
    default:
      return undefined;
  }
}

/** The text of a string literal or of an expression-free template literal. */
function textOf(node: unknown): string | undefined {
  switch (fieldOf(node, 'type')) {
    case 'StringLiteral': {
      const text = fieldOf(node, 'value');

      return typeof text === 'string' ? text : undefined;
    }
    case 'TemplateLiteral': {
      const quasis = fieldOf(node, 'quasis');
      const text = fieldOf(
        fieldOf(Array.isArray(quasis) ? quasis[0] : undefined, 'value'),
        'cooked',
      );

      return Array.isArray(quasis) &&
        quasis.length === 1 &&
        typeof text === 'string'
        ? text
        : undefined;
    }
    default:
      return undefined;
  }
}

/** The value of the `name` property of an object literal, when the property is written out. */
function nameOf(options: unknown): unknown {
  const properties = fieldOf(options, 'properties');
  const property: unknown = Array.isArray(properties)
    ? properties.find(
        (candidate) =>
          fieldOf(candidate, 'type') === 'ObjectProperty' &&
          fieldOf(candidate, 'computed') === false &&
          (fieldOf(fieldOf(candidate, 'key'), 'name') === 'name' ||
            fieldOf(fieldOf(candidate, 'key'), 'value') === 'name'),
      )
    : undefined;

  return fieldOf(property, 'value');
}

export function roleSite(call: unknown): Site | undefined {
  const role = argumentOf(call, 0);
  const name = nameOf(argumentOf(call, 1));
  const value = valueOf(name);

  return methodOf(call) === 'getByRole' &&
    fieldOf(role, 'type') === 'StringLiteral' &&
    value !== undefined
    ? { key: `getByRole:${valueOf(role)}`, value, node: name }
    : undefined;
}

/** The first argument of a call to one of the methods; the method is the key. */
function firstArgumentSite(methods: readonly string[]): SiteReader {
  return (call) => {
    const method = methodOf(call);
    const argument = argumentOf(call, 0);
    const value = valueOf(argument);

    return typeof method === 'string' &&
      methods.includes(method) &&
      value !== undefined
      ? { key: method, value, node: argument }
      : undefined;
  };
}

/** `Button/Primary` and `components/Button/Primary` name the same story. */
export function isSameStory(one: string, other: string): boolean {
  return (
    one === other || one.endsWith(`/${other}`) || other.endsWith(`/${one}`)
  );
}

export function mountStorySite(call: unknown): Site | undefined {
  const argument = argumentOf(call, 0);
  const value = textOf(argument);

  return (fieldOf(fieldOf(call, 'callee'), 'name') === 'mount' ||
    methodOf(call) === 'mount') &&
    value !== undefined
    ? { key: 'mount', value, node: argument }
    : undefined;
}

export const testIdSite = firstArgumentSite(['getByTestId']);

export const textSite = firstArgumentSite([
  'getByText',
  'getByLabel',
  'getByPlaceholder',
  'getByAltText',
  'getByTitle',
]);
