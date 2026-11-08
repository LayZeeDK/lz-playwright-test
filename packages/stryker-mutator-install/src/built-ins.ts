import type { Instrumenter, InstrumenterLocation } from './instrumenter.ts';

export const builtInNames: readonly string[] = [
  'ArithmeticOperator',
  'ArrayDeclaration',
  'ArrowFunction',
  'AssignmentOperator',
  'BlockStatement',
  'BooleanLiteral',
  'CallExpression',
  'ConditionalExpression',
  'EqualityOperator',
  'LogicalOperator',
  'MethodExpression',
  'ObjectLiteral',
  'OptionalChaining',
  'Regex',
  'StringLiteral',
  'UnaryOperator',
  'UpdateOperator',
];

export function removeBuiltIns(
  packageName: string,
  instrumenter: InstrumenterLocation &
    Pick<Instrumenter<unknown>, 'allMutators'>,
  warn: (message: string) => void,
): void {
  const { allMutators } = instrumenter;
  const present = allMutators.map(({ name }) => name);
  const missing = builtInNames.filter((name) => !present.includes(name));

  if (missing.length === builtInNames.length) {
    return;
  }

  if (missing.length > 0) {
    throw new Error(
      `${packageName}: @stryker-mutator/instrumenter ${instrumenter.version} in ${instrumenter.dir} has no built-in mutators ` +
        `named ${missing.join(', ')}, so this package's list of Stryker's built-ins is out of date.`,
    );
  }

  for (const mutator of allMutators) {
    if (!builtInNames.includes(mutator.name) && !isLayzeeMarked(mutator)) {
      warn(
        `${packageName}: the mutator ${mutator.name} is not one of Stryker's 17 built-ins and has no ` +
          '@layzee mark, so it stays on in this run; this package has not reviewed whether it fits test code.',
      );
    }
  }

  const kept = allMutators.filter(({ name }) => !builtInNames.includes(name));

  allMutators.splice(0, allMutators.length, ...kept);
}

function isLayzeeMarked(mutator: object): boolean {
  return Object.getOwnPropertySymbols(mutator).some((symbol) =>
    Symbol.keyFor(symbol)?.startsWith('@layzee/'),
  );
}
