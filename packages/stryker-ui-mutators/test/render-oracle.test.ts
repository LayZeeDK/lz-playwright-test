// Every mutant, active in the instrumented build, renders in React 19 like the original source with that mutant's
// replacement spliced in at its location; with no mutant active, the build renders like the original. The fixture
// is the design spike's sample (spikes/design-opus/sample.tsx), rendered for two prop scenarios into a serialized
// element tree (props, handler presence, children).
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { pathToFileURL } from 'node:url';

import { install, resolveFromCore, type InstrumentedMutant } from '../src/install.ts';
import { operatorNames, operators } from '../src/operators.ts';

type Component = (props: unknown) => unknown;

interface ElementLike {
  readonly type: string | symbol | Component;
  readonly props: { readonly children?: unknown } & Record<string, unknown>;
}

const root = join(import.meta.dirname, '..', '..', '..');
const samplePath = join(root, 'spikes', 'design-opus', 'sample.tsx');
const source = readFileSync(samplePath, 'utf8');
// Under the package, so the transpiled modules resolve react from the workspace; `tmp` is ignored by git.
const outDir = join(import.meta.dirname, '..', 'tmp', 'render-oracle');
const ts: typeof import('typescript') = createRequire(join(root, 'package.json'))('typescript');

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const instrumenter = await resolveFromCore();
await install(operators, async () => instrumenter);
const result = await instrumenter.instrument([{ name: samplePath, content: source }]);
const instrumented = result.files[0]!.content;
let counter = 0;

async function load(tsx: string): Promise<Component> {
  const js = ts.transpileModule(tsx, {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const file = join(outDir, `m${counter++}.mjs`);
  writeFileSync(file, js);
  const module: { App: Component } = await import(pathToFileURL(file).href);

  return module.App;
}

const FRAGMENT = Symbol.for('react.fragment');

function isElement(node: object): node is ElementLike {
  return 'type' in node && 'props' in node;
}

function serialize(node: unknown): string {
  if (node === null || node === undefined || typeof node === 'boolean') {
    return '';
  }

  if (typeof node !== 'object') {
    return JSON.stringify(String(node));
  }

  if (Array.isArray(node)) {
    return node.map(serialize).join('');
  }

  if (!isElement(node)) {
    return `UNKNOWN ${JSON.stringify(node)}`;
  }

  const { type, props } = node;

  if (typeof type === 'function') {
    return `<${type.name}>${serialize(type(props))}</${type.name}>`;
  }

  if (type === FRAGMENT) {
    return serialize(props.children);
  }

  const { children, ...rest } = props;
  const attributes = Object.keys(rest)
    .sort()
    .filter((key) => rest[key] !== undefined)
    .map((key) => `${key}=${typeof rest[key] === 'function' ? 'fn' : JSON.stringify(rest[key])}`)
    .join(' ');

  return `<${String(type)} ${attributes}>${serialize(children)}</${String(type)}>`;
}

const noop = (): void => {};
const scenarios = [
  {
    open: true,
    busy: false,
    items: [
      { id: '1', label: 'One' },
      { id: '2', label: 'Two' },
    ],
    user: { name: 'Ada' },
    label: 'Search',
    url: 'https://x.test',
    onClose: noop,
    onSave: noop,
  },
  { open: false, busy: true, items: [], user: { name: 'Bob' }, error: 'Boom', label: 'Find', url: '/ext', onClose: noop, onSave: noop },
];

function renderAll(App: Component): string {
  return scenarios
    .map((scenario) => {
      try {
        return serialize(App(scenario));
      } catch (error) {
        return `THROWS ${(error as Error).message}`;
      }
    })
    .join('\n');
}

function offsetOf(line: number, column: number): number {
  return source
    .split('\n')
    .slice(0, line)
    .reduce((sum, text) => sum + text.length + 1, 0) + column;
}

// The instrumented header caches the namespace object, so the test changes it in place rather than replacing it.
const namespace: { activeMutant?: string } = ((globalThis as { __stryker__?: { activeMutant?: string } }).__stryker__ ??= {});

const original = renderAll(await load(source));
const build = await load(instrumented);

/** Each mutant's render through the build and through the hand-applied source, `undefined` id for the baseline. */
async function renders(mutant: InstrumentedMutant) {
  const start = offsetOf(mutant.location.start.line, mutant.location.start.column);
  const end = offsetOf(mutant.location.end.line, mutant.location.end.column);
  const expected = renderAll(await load(source.slice(0, start) + mutant.replacement + source.slice(end)));
  namespace.activeMutant = mutant.id;
  const actual = renderAll(build);
  namespace.activeMutant = undefined;

  return { actual, expected };
}

const ours: ReadonlySet<string> = new Set(operatorNames);
const label = ({ id, mutatorName, location, replacement }: InstrumentedMutant): string =>
  `${id} ${mutatorName} L${location.start.line + 1}: ${replacement.replace(/\s+/g, ' ').slice(0, 60)}`;

async function mismatches(mutants: readonly InstrumentedMutant[]): Promise<string[]> {
  const found: string[] = [];

  for (const mutant of mutants) {
    const { actual, expected } = await renders(mutant);

    if (actual !== expected) {
      found.push(`${label(mutant)}\n  expected ${expected}\n  actual   ${actual}`);
    }
  }

  return found;
}

describe('render oracle on spikes/design-opus/sample.tsx', () => {
  it('renders the instrumented build with no active mutant like the original, in both prop scenarios', () => {
    namespace.activeMutant = undefined;

    assert.equal(renderAll(build), original);
  });

  it('renders each UI mutant like its hand-applied replacement, in both prop scenarios', async () => {
    assert.deepEqual(await mismatches(result.mutants.filter(({ mutatorName }) => ours.has(mutatorName))), []);
  });

  it('renders each built-in mutant like its hand-applied replacement, in both prop scenarios', async () => {
    assert.deepEqual(await mismatches(result.mutants.filter(({ mutatorName }) => !ours.has(mutatorName))), []);
  });

  it('gives at least one mutant of every operator in the table', () => {
    assert.deepEqual(new Set(result.mutants.map(({ mutatorName }) => mutatorName).filter((name) => ours.has(name))), ours);
  });
});
