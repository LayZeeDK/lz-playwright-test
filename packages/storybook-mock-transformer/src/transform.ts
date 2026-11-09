import { parse } from '@babel/parser';
import MagicString, { type SourceMap } from 'magic-string';

import { packageName } from './package-name.ts';
import { appendRecord } from './stryker-record.ts';
import { definitionTimeStubs, type StubMethod } from './stub-shape.ts';

export interface TransformResult {
  readonly code: string;
  readonly map: SourceMap;
}

const replacements: Readonly<Record<StubMethod, (spy: string) => string>> = {
  mockReturnValue: (spy) => `((value) => ${spy}(() => value))(`,
  mockResolvedValue: (spy) => `((value) => ${spy}(async () => value))(`,
  mockRejectedValue: (spy) =>
    `((value) => ${spy}(async () => { throw value; }))(`,
  mockImplementation: (spy) => `${spy}(`,
};

export function transform(
  code: string,
  id: string,
): TransformResult | undefined {
  const [file = id] = id.split('?');

  if (!/\.[cm]?[jt]sx?$/.test(file) || !code.includes('storybook/test')) {
    return undefined;
  }

  const edits = definitionTimeStubs(parseModule(code, file)).flatMap(
    ({ spy, method, once, start, argumentStart }) =>
      once || argumentStart === undefined
        ? []
        : [{ start, end: argumentStart, text: replacements[method](spy) }],
  );

  if (edits.length === 0) {
    return undefined;
  }

  const output = new MagicString(code);
  edits.forEach(({ start, end, text }) => output.overwrite(start, end, text));
  appendRecord(file, edits.length);

  return {
    code: output.toString(),
    map: output.generateMap({ source: file, hires: true }),
  };
}

function parseModule(code: string, file: string): unknown {
  try {
    return parse(code, {
      sourceType: 'module',
      plugins: /\.[cm]?ts$/.test(file) ? ['typescript'] : ['typescript', 'jsx'],
    }).program;
  } catch (error: unknown) {
    throw new Error(
      `${packageName}: cannot parse ${file}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}
