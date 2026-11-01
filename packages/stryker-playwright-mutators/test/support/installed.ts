// Calls install() itself rather than importing index.ts, so the tests that use it also run inside a Stryker worker,
// where STRYKER_MUTATOR_WORKER makes index.ts skip the install (a mutation run of this package).
import { bundled } from '../../src/bundled-roles.ts';
import { install, type Instrumenter } from '../../src/install.ts';
import { operatorsFor, type OperatorName } from '../../src/operators.ts';

export const operatorNames: readonly OperatorName[] = operatorsFor(
  bundled.roles,
).map(({ name }) => name);

export const ours: ReadonlySet<string> = new Set(operatorNames);

export async function installInto<T extends Instrumenter>(
  instrumenter: T,
): Promise<T> {
  await install(operatorsFor(bundled.roles), async () => instrumenter);

  return instrumenter;
}
