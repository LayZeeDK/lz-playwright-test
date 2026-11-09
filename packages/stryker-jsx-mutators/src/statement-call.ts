import {
  callTypes,
  fieldOf,
  isRecord,
  memberTypes,
} from '@layzee/stryker-mutator-install';

import { typeOf } from './type-of.ts';

const effectTypes: readonly unknown[] = [
  ...callTypes,
  'ArrowFunctionExpression',
  'AssignmentExpression',
  'AwaitExpression',
  'ClassMethod',
  'ClassPrivateMethod',
  'Decorator',
  'FunctionExpression',
  'ImportExpression',
  'NewExpression',
  'ObjectMethod',
  'TaggedTemplateExpression',
  'UpdateExpression',
  'YieldExpression',
];

const effectOperators: readonly unknown[] = ['delete', 'throw', '|>'];

export function hideableCallee(node: unknown): string | undefined {
  if (typeOf(node) !== 'ExpressionStatement') {
    return undefined;
  }

  const expression = fieldOf(node, 'expression');
  const call =
    typeOf(expression) === 'AwaitExpression' ||
    fieldOf(expression, 'operator') === 'void'
      ? fieldOf(expression, 'argument')
      : expression;

  if (
    !callTypes.includes(typeOf(call)) ||
    holdsEffect(fieldOf(call, 'arguments'))
  ) {
    return undefined;
  }

  return dottedName(fieldOf(call, 'callee'));
}

function holdsEffect(node: unknown): boolean {
  return (
    effectTypes.includes(typeOf(node)) ||
    effectOperators.includes(fieldOf(node, 'operator')) ||
    (isRecord(node) && Object.values(node).some(holdsEffect))
  );
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
