import type {
  ListedMutator,
  MutatorSets,
  SampledMutator,
} from '@layzee/stryker-mutator-install';

export type LzPlaywrightMutator = SampledMutator & ListedMutator;

export const mutatorSets: MutatorSets<LzPlaywrightMutator> = {
  defaults: [],
  optIn: [],
  experimental: [],
};
