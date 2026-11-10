import { parse } from '@babel/parser';

// Stryker 10.1.1 instrumenter, src/parsers/ts-parser.ts
export function parseProgram(
  code: string,
  fileName: string,
): ReturnType<typeof parse>['program'] {
  return parse(code, {
    sourceType: 'module',
    plugins: /\.[cm]?ts$/.test(fileName)
      ? ['typescript', 'decorators-legacy']
      : ['typescript', 'jsx', 'decorators-legacy'],
  }).program;
}
