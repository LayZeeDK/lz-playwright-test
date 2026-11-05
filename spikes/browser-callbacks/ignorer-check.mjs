// Instruments source.spec.ts with the ignorer and prints which mutants stay and whether the callback text is clean.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

import ignorer from './serialized-callback-ignorer.mjs';

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
const content = readFileSync(
  new URL('source.spec.ts', import.meta.url),
  'utf8',
);
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
  { plugins: null, excludedMutations: [], ignorers: [ignorer] },
);
const code = result.files[0].content;
const callback = code.slice(
  code.indexOf('page.evaluate('),
  code.indexOf('});', code.indexOf('page.evaluate(')) + 3,
);

for (const m of result.mutants) {
  console.log(`${m.id}\t${m.mutatorName}\t${m.status ?? 'placed'}`);
}

console.log(
  `helpers inside the callback: ${/stry(MutAct|Cov)_9fa48/.test(callback)}`,
);
