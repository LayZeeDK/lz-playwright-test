import { fieldOf } from '@layzee/stryker-mutator-install';

import { isCall, isTestCallee } from './ast.ts';

export function looksLikePlaywrightTest(program: unknown): boolean {
  const body = fieldOf(program, 'body');

  return (
    Array.isArray(body) &&
    body.some(
      (statement) =>
        isPlaywrightImport(statement) || isTopLevelTestCall(statement),
    )
  );
}

function isPlaywrightImport(statement: unknown): boolean {
  const source = fieldOf(fieldOf(statement, 'source'), 'value');

  return (
    fieldOf(statement, 'type') === 'ImportDeclaration' &&
    String(source).startsWith('@playwright/')
  );
}

function isTopLevelTestCall(statement: unknown): boolean {
  const call = fieldOf(statement, 'expression');

  return (
    fieldOf(statement, 'type') === 'ExpressionStatement' &&
    isCall(call) &&
    isTestCallee(fieldOf(call, 'callee'))
  );
}
