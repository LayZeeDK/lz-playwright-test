// Every mutant, active in the instrumented build, renders in React 19 like the original source with that mutant's
// replacement spliced in at its location; with no mutant active, the build renders like the original. The fixture
// is the design spike's sample (spikes/design-opus/sample.tsx), rendered for two prop scenarios into a serialized
// element tree (props, handler presence, children).
import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { pathToFileURL } from 'node:url';

import ts from 'typescript';

import {
  resolveFromCore,
  type InstrumentedMutant,
  type InstrumentResult,
} from '../src/install.ts';
import { defined } from './support/defined.ts';
import { exportedFunction } from './support/exports.ts';
import { installInto, ours } from './support/installed.ts';

type Component = (props: unknown) => unknown;

interface ElementLike {
  readonly type: string | symbol | Component;
  readonly props: { readonly children?: unknown } & Record<string, unknown>;
}

const root = join(import.meta.dirname, '..', '..', '..');
const samplePath = join(root, 'spikes', 'design-opus', 'sample.tsx');
const source = readFileSync(samplePath, 'utf8');
// Under the package, not os.tmpdir(), so the `react/jsx-runtime` import the transpiler emits resolves from the
// workspace; `tmp` is ignored by git. A directory per process, removed after it, as a Stryker run of this package
// runs several processes of this file in one sandbox at once.
const tmpDir = join(import.meta.dirname, '..', 'tmp');
let outDir: string;
let result: InstrumentResult;
let original: string;
let build: Component;
let counter = 0;

// The build gets a runtime namespace and an active-mutant variable of its own, so that it never reads or counts the
// mutants of a Stryker run of this package in the same process.
function isolated(code: string): string {
  return code
    .replaceAll('__stryker__', '__renderOracle__')
    .replaceAll('__STRYKER_ACTIVE_MUTANT__', '__RENDER_ORACLE_ACTIVE_MUTANT__');
}

before(async () => {
  mkdirSync(tmpDir, { recursive: true });
  outDir = mkdtempSync(join(tmpDir, 'render-oracle-'));
  const instrumenter = await installInto(await resolveFromCore());
  result = await instrumenter.instrument([
    { name: samplePath, content: source },
  ]);
  original = renderAll(await load(source));
  build = await load(isolated(defined(result.files[0]).content));
});
after(() => rmSync(outDir, { recursive: true, force: true }));

async function load(tsx: string): Promise<Component> {
  const js = ts.transpileModule(tsx, {
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const file = join(outDir, `m${counter++}.mjs`);
  writeFileSync(file, js);
  const app = exportedFunction(await import(pathToFileURL(file).href), 'App');

  return (props): unknown => Reflect.apply(app, undefined, [props]);
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
    .map(
      (key) =>
        `${key}=${typeof rest[key] === 'function' ? 'fn' : JSON.stringify(rest[key])}`,
    )
    .join(' ');

  return `<${String(type)} ${attributes}>${serialize(children)}</${String(type)}>`;
}

const noop = (): undefined => undefined;
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
  {
    open: false,
    busy: true,
    items: [],
    user: { name: 'Bob' },
    error: 'Boom',
    label: 'Find',
    url: '/ext',
    onClose: noop,
    onSave: noop,
  },
];

function renderAll(App: Component): string {
  return scenarios
    .map((scenario) => {
      try {
        return serialize(App(scenario));
      } catch (error) {
        return `THROWS ${String(error)}`;
      }
    })
    .join('\n');
}

function offsetOf(line: number, column: number): number {
  return (
    source
      .split('\n')
      .slice(0, line)
      .reduce((sum, text) => sum + text.length + 1, 0) + column
  );
}

declare global {
  var __renderOracle__: unknown;
}

// The instrumented header caches the namespace object, so the test changes it in place rather than replacing it.
const namespace: { activeMutant?: string | undefined } = {};
globalThis.__renderOracle__ = namespace;

/** Each mutant's render through the build and through the hand-applied source, `undefined` id for the baseline. */
async function renders(mutant: InstrumentedMutant) {
  const start = offsetOf(
    mutant.location.start.line,
    mutant.location.start.column,
  );
  const end = offsetOf(mutant.location.end.line, mutant.location.end.column);
  const expected = renderAll(
    await load(source.slice(0, start) + mutant.replacement + source.slice(end)),
  );
  namespace.activeMutant = mutant.id;
  const actual = renderAll(build);
  namespace.activeMutant = undefined;

  return { actual, expected };
}

const label = ({
  id,
  mutatorName,
  location,
  replacement,
}: InstrumentedMutant): string =>
  `${id} ${mutatorName} L${location.start.line + 1}: ${replacement.replace(/\s+/g, ' ').slice(0, 60)}`;

async function mismatches(
  mutants: readonly InstrumentedMutant[],
): Promise<string[]> {
  const found: string[] = [];

  for (const mutant of mutants) {
    const { actual, expected } = await renders(mutant);

    if (actual !== expected) {
      found.push(
        `${label(mutant)}\n  expected ${expected}\n  actual   ${actual}`,
      );
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
    assert.deepEqual(
      await mismatches(
        result.mutants.filter(({ mutatorName }) => ours.has(mutatorName)),
      ),
      [],
    );
  });

  it('renders each built-in mutant like its hand-applied replacement, in both prop scenarios', async () => {
    assert.deepEqual(
      await mismatches(
        result.mutants.filter(({ mutatorName }) => !ours.has(mutatorName)),
      ),
      [],
    );
  });

  it('gives at least one mutant of every operator in the table', () => {
    assert.deepEqual(
      new Set(
        result.mutants
          .map(({ mutatorName }) => mutatorName)
          .filter((name) => ours.has(name)),
      ),
      ours,
    );
  });
});
