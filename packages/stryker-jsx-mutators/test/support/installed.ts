// Calls install() itself rather than importing index.ts, so the tests that use it also run inside a Stryker worker,
// where STRYKER_MUTATOR_WORKER makes index.ts skip the install (a mutation run of this package).
import { implicitRoles } from '../../src/implicit-roles.ts';
import { install, type Instrumenter } from '../../src/install.ts';
import { mutatorsFor, type MutatorName } from '../../src/mutators.ts';

export const mutatorNames: readonly MutatorName[] = mutatorsFor(
  implicitRoles,
).map(({ name }) => name);

export const ours: ReadonlySet<string> = new Set(mutatorNames);

export async function installInto<T extends Instrumenter>(
  instrumenter: T,
): Promise<T> {
  await install(mutatorsFor(implicitRoles), async () => instrumenter);

  return instrumenter;
}
