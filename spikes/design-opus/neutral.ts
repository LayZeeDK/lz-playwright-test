// Spike part 2: is the placer patch neutral for built-in mutants, and how many UI mutants do real files get?
// MODE=plain   -> stock instrumenter
// MODE=patched -> install(), UI operators excluded via mutator.excludedMutations (must equal plain output)
// MODE=ui      -> install(), UI operators on (prints counts)
// Run: MODE=plain node spikes/design-opus/neutral.ts; MODE=patched node ...; MODE=ui node ...
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { install, instrumenterDir, operators } from './ui-mutators.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const projectRoot = join(here, '../..');
const mode = process.env.MODE ?? 'plain';
const files = [
  join(here, 'sample.tsx'),
  join(projectRoot, 'apps/demo-app/src/app/app.tsx'),
  join(projectRoot, 'apps/demo-app/src/app/price-tag.tsx'),
];

if (mode !== 'plain') {
  await install(projectRoot);
}

const dir = instrumenterDir(projectRoot);
const { Instrumenter } = await import(pathToFileURL(join(dir, 'dist/src/index.js')).href);
const babelParser = createRequire(join(dir, 'package.json'))('@babel/parser');
const uiNames = operators.map((o) => o.name);
const logger = { isDebugEnabled: () => false, debug() {}, info() {}, warn: console.error, error: console.error, trace() {}, fatal() {} };

for (const name of files) {
  const content = readFileSync(name, 'utf8');
  const result = await new Instrumenter(logger).instrument([{ name, content, mutate: true }], {
    plugins: null,
    excludedMutations: mode === 'patched' ? uiNames : [],
    ignorers: [],
  });
  const out: string = result.files[0].content;
  babelParser.parse(out, { sourceType: 'module', plugins: ['typescript', 'jsx'] });
  const placed = result.mutants.filter((m: { status?: string }) => m.status !== 'Ignored');
  const ui = placed.filter((m: { mutatorName: string }) => uiNames.includes(m.mutatorName));
  const perOp = uiNames.map((n) => `${n}=${ui.filter((m: { mutatorName: string }) => m.mutatorName === n).length}`).join(' ');
  const hash = createHash('sha256').update(out.replace(/(stryMutAct_9fa48|stryCov_9fa48)\([^)]*\)/g, '$1(#)')).digest('hex').slice(0, 12);
  console.log(`${mode} ${name.split(/[\\/]/).pop()}: sha (ids masked) ${hash}, ${content.length} -> ${out.length} chars, mutants placed ${placed.length} (ui ${ui.length}), ignored ${result.mutants.length - placed.length}${mode === 'ui' ? `\n  ${perOp}` : ''}`);
}
