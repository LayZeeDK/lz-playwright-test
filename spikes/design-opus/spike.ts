// Spike: does JSX-safe placement make every UI mutant behave exactly like its hand-applied source edit?
// Oracle per mutant: render(instrumented build, activeMutant = id) must equal render(original source with
// the mutant's replacement spliced in at its location). Also: no active mutant must equal the original.
// Run: node spikes/design-opus/spike.ts
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { install, operators } from './ui-mutators.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const projectRoot = join(here, '../..');
const outDir = join(here, 'out');
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir);

const { added, dir } = await install(projectRoot);
const again = await install(projectRoot);
assert.deepEqual(again.added, [], 'install is idempotent');

const { Instrumenter } = await import(pathToFileURL(join(dir, 'dist/src/index.js')).href);
const babelParser = createRequire(join(dir, 'package.json'))('@babel/parser');
const ts = createRequire(join(projectRoot, 'package.json'))('typescript');

const samplePath = join(here, 'sample.tsx');
const source = readFileSync(samplePath, 'utf8');
const logger = { isDebugEnabled: () => false, debug() {}, info() {}, warn: console.error, error: console.error, trace() {}, fatal() {} };
const result = await new Instrumenter(logger).instrument([{ name: samplePath, content: source, mutate: true }], {
  plugins: null,
  excludedMutations: [],
  ignorers: [],
});
const instrumented: string = result.files[0].content;
babelParser.parse(instrumented, { sourceType: 'module', plugins: ['typescript', 'jsx'] });
writeFileSync(join(outDir, 'instrumented.tsx'), instrumented);

let counter = 0;

async function load(tsx: string) {
  const js = ts.transpileModule(tsx, {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const file = join(outDir, `m${counter++}.mjs`);
  writeFileSync(file, js);

  return (await import(pathToFileURL(file).href)) as { App: (p: unknown) => unknown };
}

const FRAGMENT = Symbol.for('react.fragment');

function serialize(node: any): string {
  if (node === null || node === undefined || typeof node === 'boolean') {
    return '';
  }

  if (typeof node !== 'object') {
    return JSON.stringify(String(node));
  }

  if (Array.isArray(node)) {
    return node.map(serialize).join('');
  }

  if (typeof node.type === 'function') {
    return `<${node.type.name}>${serialize(node.type(node.props))}</${node.type.name}>`;
  }

  if (node.type === FRAGMENT) {
    return serialize(node.props.children);
  }

  const { children, ...rest } = node.props;
  const props = Object.keys(rest)
    .sort()
    .filter((k) => rest[k] !== undefined)
    .map((k) => `${k}=${typeof rest[k] === 'function' ? 'fn' : JSON.stringify(rest[k])}`)
    .join(' ');

  return `<${node.type} ${props}>${serialize(children)}</${node.type}>`;
}

const noop = () => {};
const scenarios = [
  { open: true, busy: false, items: [{ id: '1', label: 'One' }, { id: '2', label: 'Two' }], user: { name: 'Ada' }, label: 'Search', url: 'https://x.test', onClose: noop, onSave: noop },
  { open: false, busy: true, items: [], user: { name: 'Bob' }, error: 'Boom', label: 'Find', url: '/ext', onClose: noop, onSave: noop },
];

function renderAll(App: (p: unknown) => unknown): string {
  return scenarios
    .map((s) => {
      try {
        return serialize(App(s));
      } catch (e) {
        return `THROWS ${(e as Error).message}`;
      }
    })
    .join('\n');
}

function offsetOf(line: number, column: number): number {
  const lines = source.split('\n');

  return lines.slice(0, line).reduce((sum, l) => sum + l.length + 1, 0) + column;
}

const setActive = (id: string | undefined) => {
  // The header caches the namespace object, so mutate it rather than replacing it.
  const ns = ((globalThis as any).__stryker__ ??= {});
  ns.activeMutant = id;
};

const original = renderAll((await load(source)).App);
const build = (await load(instrumented)).App;
setActive(undefined);
assert.equal(renderAll(build), original, 'instrumented build with no active mutant renders like the original');

const uiNames = new Set(operators.map((o) => o.name));
const rows: string[] = [];
const mismatches: string[] = [];
const equalToOriginal: string[] = [];

for (const m of result.mutants) {
  const start = offsetOf(m.location.start.line, m.location.start.column);
  const end = offsetOf(m.location.end.line, m.location.end.column);
  const expected = renderAll((await load(source.slice(0, start) + m.replacement + source.slice(end))).App);
  setActive(m.id);
  const actual = renderAll(build);
  const ok = actual === expected;

  if (!ok) {
    mismatches.push(`${m.id} ${m.mutatorName} L${m.location.start.line + 1}: ${m.replacement.slice(0, 60)}\n  expected ${expected}\n  actual   ${actual}`);
  }

  if (actual === original) {
    equalToOriginal.push(`${m.id} ${m.mutatorName} L${m.location.start.line + 1} ${m.replacement.replace(/\s+/g, ' ').slice(0, 50)}`);
  }

  if (uiNames.has(m.mutatorName)) {
    rows.push(`${ok ? 'ok  ' : 'FAIL'} L${m.location.start.line + 1} ${m.mutatorName}: ${source.slice(start, end).replace(/\s+/g, ' ').slice(0, 40)} -> ${m.replacement.replace(/\s+/g, ' ').slice(0, 50)}`);
  }
}

setActive(undefined);
const byName = new Map<string, number>();

for (const m of result.mutants) {
  byName.set(m.mutatorName, (byName.get(m.mutatorName) ?? 0) + 1);
}

console.log(`installed: ${added.join(', ')}`);
console.log(`mutants: ${result.mutants.length} total, ${result.mutants.filter((m: any) => uiNames.has(m.mutatorName)).length} from UI operators`);
console.log(`per mutator: ${[...byName].map(([k, v]) => `${k}=${v}`).join(' ')}`);
console.log(`size: original ${source.length} chars, instrumented ${instrumented.length} chars`);
console.log('UI mutants (ok = instrumented render equals hand-applied render in both scenarios):');
console.log(rows.join('\n'));
console.log(`mutants rendering identically to the original in both scenarios (equivalent for this oracle): ${equalToOriginal.length}`);
console.log(equalToOriginal.join('\n'));
console.log(`mismatches: ${mismatches.length}`);
console.log(mismatches.join('\n'));
process.exitCode = mismatches.length ? 1 : 0;
