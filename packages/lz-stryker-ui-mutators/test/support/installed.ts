// Calls install() itself rather than importing index.ts, so the tests that use it also run inside a Stryker worker,
// where STRYKER_MUTATOR_WORKER makes index.ts skip the install (a mutation run of this package).
import { install, type Instrumenter } from '../../src/install.ts';
import { operatorNames, operators } from '../../src/operators.ts';

export const ours: ReadonlySet<string> = new Set(operatorNames);

export async function installInto(
  instrumenter: Instrumenter,
): Promise<Instrumenter> {
  await install(operators, async () => instrumenter);

  return instrumenter;
}
