import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

import { corePackageJson, fieldOf } from '@layzee/stryker-mutator-install';

/** The Program node of `source`, parsed by the Babel of the Stryker instrumenter in use. */
export async function programOf(source: string): Promise<unknown> {
  const instrumenterJson = createRequire(corePackageJson()).resolve(
    '@stryker-mutator/instrumenter/package.json',
  );
  const babelPath = createRequire(instrumenterJson).resolve('@babel/core');
  const parseSync = fieldOf(
    await import(pathToFileURL(babelPath).href),
    'parseSync',
  );

  if (typeof parseSync !== 'function') {
    throw new Error('@babel/core has no parseSync');
  }

  const file: unknown = Reflect.apply(parseSync, undefined, [
    source,
    {
      filename: 'sample.tsx',
      configFile: false,
      babelrc: false,
      parserOpts: { plugins: ['typescript', 'jsx'] },
    },
  ]);

  return fieldOf(file, 'program');
}
