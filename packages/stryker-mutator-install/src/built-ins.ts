import type { Instrumenter } from './instrumenter.ts';

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
  instrumenter: Pick<Instrumenter<unknown>, 'allMutators' | 'dir' | 'version'>,
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
      `${packageName}: the instrumenter ${instrumenter.version} in ${instrumenter.dir} has no built-in mutators ` +
        `named ${missing.join(', ')}, so this module's list of Stryker's built-ins is out of date.`,
    );
  }

  for (const mutator of allMutators) {
    if (!builtInNames.includes(mutator.name) && !isLayzeeMarked(mutator)) {
      warn(
        `${packageName}: the mutator ${mutator.name} is not one of the 17 built-ins this module knows and has no ` +
          '@layzee mark, so it stays on in this run and its reason is unreviewed.',
      );
    }
  }

  for (let index = allMutators.length - 1; index >= 0; index--) {
    if (builtInNames.includes(allMutators[index]?.name ?? '')) {
      allMutators.splice(index, 1);
    }
  }
}

function isLayzeeMarked(mutator: object): boolean {
  return Object.getOwnPropertySymbols(mutator).some((symbol) =>
    Symbol.keyFor(symbol)?.startsWith('@layzee/'),
  );
}
