import { fieldOf, isRecord } from '@layzee/stryker-mutator-install';

import { callTypes } from './ast.ts';
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
