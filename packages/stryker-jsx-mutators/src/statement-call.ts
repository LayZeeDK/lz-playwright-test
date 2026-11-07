import { fieldOf, typeOf } from './is-record.ts';

const callTypes: readonly unknown[] = [
  'CallExpression',
  'OptionalCallExpression',
];
const memberTypes: readonly unknown[] = [
  'MemberExpression',
  'OptionalMemberExpression',
];

export function statementCallee(node: unknown): string | undefined {
  if (typeOf(node) !== 'ExpressionStatement') {
    return undefined;
  }

  const expression = fieldOf(node, 'expression');
  const call =
    typeOf(expression) === 'AwaitExpression' ||
    fieldOf(expression, 'operator') === 'void'
      ? fieldOf(expression, 'argument')
      : expression;

  if (!callTypes.includes(typeOf(call))) {
    return undefined;
  }

  return dottedName(fieldOf(call, 'callee'));
}

function dottedName(node: unknown): string | undefined {
  if (typeOf(node) === 'Identifier') {
    return String(fieldOf(node, 'name'));
  }

  if (!memberTypes.includes(typeOf(node)) || fieldOf(node, 'computed')) {
    return undefined;
  }

  const object = dottedName(fieldOf(node, 'object'));

  return (
    object && `${object}.${String(fieldOf(fieldOf(node, 'property'), 'name'))}`
  );
}
