// Spike part 3: do `Stryker disable` comments and excludedMutations reach the UI operators inside JSX?
// Run: node spikes/design-opus/directive.ts
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { install } from './ui-mutators.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const { dir } = await install(join(here, '../..'));
const { Instrumenter } = await import(pathToFileURL(join(dir, 'dist/src/index.js')).href);
const warnings: string[] = [];
const logger = { isDebugEnabled: () => false, debug() {}, info() {}, warn: (m: string) => warnings.push(m), error: console.error, trace() {}, fatal() {} };

const content = `export function A() {
  return (
    <main>
      {/* Stryker disable next-line TextContent */}
      <h1>JSX comment directive</h1>
      <h2>No directive</h2>
      {
        // Stryker disable next-line TextContent
        <h3>Line comment in container</h3>
      }
    </main>
  );
}
// Stryker disable next-line TextContent
export const B = () => <p>JS comment directive</p>;
`;

const result = await new Instrumenter(logger).instrument([{ name: join(here, 'directive.tsx'), content, mutate: true }], {
  plugins: null,
  excludedMutations: [],
  ignorers: [],
});

for (const m of result.mutants) {
  console.log(`L${m.location.start.line + 1} ${m.mutatorName} ${m.status ?? 'placed'} ${m.statusReason ?? ''}`);
}

console.log(`warnings: ${warnings.length ? warnings.join(' | ') : 'none'}`);
