import { parse } from '@babel/parser';

export function parseProgram(code: string, fileName: string): unknown {
  return parse(code, {
    sourceType: 'module',
    plugins: /\.[cm]?ts$/.test(fileName)
      ? ['typescript']
      : ['typescript', 'jsx'],
  }).program;
}
