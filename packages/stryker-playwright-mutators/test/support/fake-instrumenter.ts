import {
  builtInNames,
  markOf,
  selfCheckFile,
} from '@layzee/stryker-mutator-install';
import type {
  ListedMutator,
  MutatorSets,
} from '@layzee/stryker-mutator-install';

import {
  testedVersion,
  type BabelTypes,
  type Instrumenter,
} from '../../src/install.ts';
import type { LzPlaywrightMutator } from '../../src/mutators.ts';

export const fakeTypes: BabelTypes = {
  emptyStatement: () => ({}),
  cloneNode: (node) => node,
  objectExpression: () => ({}),
  arrayExpression: () => ({}),
  stringLiteral: () => ({}),
  numericLiteral: () => ({}),
  callExpression: () => ({}),
  memberExpression: () => ({}),
  identifier: () => ({}),
};

export const ownMark = markOf('@layzee/stryker-playwright-mutators');

export function mutator(name: string): LzPlaywrightMutator {
  return {
    name,
    sample: `export const ${name.toLowerCase()} = 1;\n`,
    mutate: () => [],
  };
}

export function sets(
  defaults: readonly string[],
  optIn: readonly string[] = [],
  experimental: readonly string[] = [],
): MutatorSets<LzPlaywrightMutator> {
  return {
    defaults: defaults.map(mutator),
    optIn: optIn.map(mutator),
    experimental: experimental.map(mutator),
  };
}

/**
 * A fake instrumenter that holds the 17 built-ins. Each marked mutator not in `silent` makes one mutant in its own
 * self-check file, and the built-ins named in `leaking` make a mutant of the negative sample.
 */
export function fakeInstrumenter({
  silent = [],
  leaking = [],
  version = testedVersion,
  extra = [],
}: {
  readonly silent?: readonly string[];
  readonly leaking?: readonly string[];
  readonly version?: string;
  readonly extra?: readonly ListedMutator[];
} = {}) {
  const allMutators: ListedMutator[] = [
    ...builtInNames.map((name) => ({ name, mutate: () => undefined })),
    ...extra,
  ];
  const instrumented: { name: string; content: string }[][] = [];
  const instrumenter: Instrumenter = {
    dir: '/stryker/instrumenter',
    version,
    types: fakeTypes,
    allMutators,
    async instrument(files) {
      instrumented.push([...files]);

      return [
        ...allMutators
          .filter(
            (listed) => ownMark in listed && !silent.includes(listed.name),
          )
          .map((listed) => ({
            fileName: selfCheckFile(listed.name),
            mutatorName: listed.name,
          })),
        ...leaking.map((mutatorName) => ({
          fileName: selfCheckFile('built-ins'),
          mutatorName,
        })),
      ];
    },
  };

  return {
    instrumenter,
    instrumented,
    names: () => allMutators.map(({ name }) => name),
  };
}
