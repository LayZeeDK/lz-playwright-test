// Writes Stryker's instrumented copy of source.spec.ts and the helper header Stryker puts at the top of every file.
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const coreDir = require
  .resolve('@stryker-mutator/core/package.json')
  .replace(/package\.json$/, '');
const instrumenterEntry = createRequire(coreDir).resolve(
  '@stryker-mutator/instrumenter',
);
const { Instrumenter } = await import(
  pathToFileURL(instrumenterEntry.replace(/index\.js$/, 'instrumenter.js')).href
);
const here = new URL('.', import.meta.url);
const content = readFileSync(new URL('source.spec.ts', here), 'utf8');
const logger = {
  isDebugEnabled: () => false,
  isTraceEnabled: () => false,
  debug: () => undefined,
  trace: () => undefined,
  info: () => undefined,
  warn: console.warn,
  error: console.error,
  fatal: console.error,
};
const result = await new Instrumenter(logger).instrument(
  [{ name: 'source.spec.ts', content, mutate: true }],
  { plugins: null, excludedMutations: [], ignorers: [] },
);
const code = result.files[0].content;
const start = code.indexOf('function stryNS_9fa48');
const end =
  code.indexOf('return isActive(id);\n}', start) +
  'return isActive(id);\n}'.length;

writeFileSync(
  new URL('instrumented.spec.ts', here),
  code.replace("from '@playwright/test'", "from './fixtures.ts'"),
);
writeFileSync(new URL('helpers.js', here), code.slice(start, end));

for (const m of result.mutants) {
  console.log(
    `${m.id}\t${m.mutatorName}\t${JSON.stringify(m.replacement)}\tline ${m.location.start.line}`,
  );
}
