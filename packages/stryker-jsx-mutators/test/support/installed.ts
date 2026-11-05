// Calls install() with the instrumenter a test passes, so the test controls which instrumenter gets the mutators.
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
