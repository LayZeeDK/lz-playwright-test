import { selfCheckFile } from './install.ts';
import type { Instrumenter, Located } from './instrumenter.ts';

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

/** A source file in which each of the 17 built-ins makes at least one mutant. */
export const builtInSample = `export function sample(a: number, b: number, text: string, notify: () => void, maybe?: { value: string }) {
  let total = a + b;
  total += 1;
  total++;

  const flags = [true, -total];
  const options = { text, flags };
  const matches = /^a+\\d$/.test(text.trim());
  const shout = () => text.toUpperCase();
  const value = maybe?.value;

  if (a === b && matches) {
    notify();
    console.log('same', options, shout(), value);
  }

  return a > b ? total : 0;
}
`;

export async function checkBuiltInsRemoved(
  packageName: string,
  instrumenter: Pick<Located, 'dir' | 'version'> &
    Pick<Instrumenter<unknown>, 'instrument'>,
): Promise<void> {
  const mutants = await instrumenter.instrument([
    { name: selfCheckFile('built-ins'), content: builtInSample },
  ]);
  const remaining = builtInNames.filter((name) =>
    mutants.some(({ mutatorName }) => mutatorName === name),
  );

  if (remaining.length > 0) {
    throw new Error(
      `${packageName}: the instrumenter ${instrumenter.version} in ${instrumenter.dir} still made mutants of the ` +
        `built-ins ${remaining.join(', ')} after this package removed them, so it does not run the list this ` +
        'package changed. A bundled or second copy of the instrumenter does that.',
    );
  }
}

export function removeBuiltIns(
  packageName: string,
  instrumenter: Pick<Located, 'dir' | 'version'> &
    Pick<Instrumenter<unknown>, 'allMutators'>,
  warn: (message: string) => void,
): void {
  const { allMutators } = instrumenter;
  const present = allMutators.map(({ name }) => name);
  const missing = builtInNames.filter((name) => !present.includes(name));
  const alreadyRemoved = missing.length === builtInNames.length;

  if (alreadyRemoved) {
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
