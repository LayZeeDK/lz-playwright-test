import {
  checkNames,
  corePackageJson,
  fieldOf,
  markOf,
  register,
  resolveExpressionPlacer,
  resolveInstrumenter,
  selfCheck,
  undoOnThrow,
  warnUntested,
  type ExpressionPlacer,
  type Instrumenter as CoreInstrumenter,
} from '@layzee/stryker-mutator-install';

import {
  babelTypeMembers,
  toNodeMutator,
  type BabelTypes,
  type Mutator,
} from './mutator.ts';
import { withJsxPlacement } from './placer.ts';
import { packageName } from './package-name.ts';

export {
  coreInstrument,
  corePackageJson,
  type MutantOrigin,
  type SourceFile,
} from '@layzee/stryker-mutator-install';

export interface Instrumenter extends CoreInstrumenter<BabelTypes> {
  readonly expressionPlacer: ExpressionPlacer;
}

export const testedVersion = '10.1.1';
const ownMark = markOf(packageName);

export async function install(
  mutators: readonly Mutator[],
  resolve: () => Promise<Instrumenter> = resolveFromCore,
  warn: (message: string) => void = console.warn,
): Promise<void> {
  const instrumenter = await resolve();
  const { allMutators, expressionPlacer, types } = instrumenter;

  checkNames(packageName, mutators, allMutators);
  await undoOnThrow([allMutators, expressionPlacer.target], async () => {
    register(
      packageName,
      allMutators,
      mutators.map((mutator) => toNodeMutator(mutator, types)),
    );

    if (!(ownMark in expressionPlacer.target)) {
      Object.assign(
        expressionPlacer.target,
        withJsxPlacement(expressionPlacer.original, types),
        { [ownMark]: ownMark },
      );
    }

    await selfCheck(packageName, instrumenter, mutators);
  });

  warnUntested(packageName, testedVersion, instrumenter, warn);
}

export async function resolveFromCore(
  corePackage: string = corePackageJson(),
): Promise<Instrumenter> {
  const instrumenter = await resolveInstrumenter(
    packageName,
    assertBabelTypes,
    corePackage,
  );

  return {
    ...instrumenter,
    expressionPlacer: await resolveExpressionPlacer(packageName, instrumenter),
  };
}

function assertBabelTypes(
  value: unknown,
  missing: (name: string) => Error,
): asserts value is BabelTypes {
  const absent = [
    ...babelTypeMembers.filter(
      (member) => typeof fieldOf(value, member) !== 'function',
    ),
    ...(typeof fieldOf(fieldOf(value, 'react'), 'buildChildren') === 'function'
      ? []
      : ['react.buildChildren']),
  ];

  if (absent.length > 0) {
    throw missing(`Babel types with ${absent.join(', ')}`);
  }
}
