import { fieldOf } from '@layzee/stryker-mutator-install';

import { isTestCallee } from './statement-removal.ts';

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
    typeof source === 'string' &&
    source.startsWith('@playwright/')
  );
}

function isTopLevelTestCall(statement: unknown): boolean {
  const call = fieldOf(statement, 'expression');

  return (
    fieldOf(statement, 'type') === 'ExpressionStatement' &&
    fieldOf(call, 'type') === 'CallExpression' &&
    isTestCallee(fieldOf(call, 'callee'))
  );
}
