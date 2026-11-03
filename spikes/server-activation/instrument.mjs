// Instruments src/total.js the way Stryker does, into out/total.js, and writes out/mutants.json.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { Instrumenter } from '@stryker-mutator/instrumenter';

const here = import.meta.dirname;
const logger = {
  isTraceEnabled: () => false,
  isDebugEnabled: () => false,
  isInfoEnabled: () => false,
  isWarnEnabled: () => true,
  isErrorEnabled: () => true,
  isFatalEnabled: () => true,
  trace() {},
  debug() {},
  info() {},
  warn: console.warn,
  error: console.error,
  fatal: console.error,
};
const name = join(here, 'src', 'total.js');
const result = await new Instrumenter(logger).instrument(
  [{ name, content: readFileSync(name, 'utf8'), mutate: true }],
  { plugins: null, excludedMutations: [], ignorers: [] },
);

mkdirSync(join(here, 'out'), { recursive: true });
writeFileSync(join(here, 'out', 'total.js'), result.files[0].content);
writeFileSync(
  join(here, 'out', 'mutants.json'),
  JSON.stringify(
    result.mutants.map(({ id, mutatorName, replacement, location }) => ({
      id,
      mutatorName,
      replacement,
      line: location.start.line + 1,
    })),
    null,
    1,
  ),
);
console.log(`${result.mutants.length} mutants`);
