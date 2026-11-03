// The placer wrap is neutral for built-in mutants, and places UI mutants as valid TSX. One process, ordered: the
// corpus is instrumented stock first, then the install runs (support/installed.ts), then the corpus is instrumented
// with every UI operator excluded. node --test runs each test file in its own process, so no other file has wrapped
// the placer before. That sequence runs in a before hook, so that an error in it fails every test instead of the file.
// Corpus: the design spike's sample, the demo app's components, and StrykerJS v10.1.1's
// packages/instrumenter/testResources/parser/App.tsx and testResources/instrumenter/vue-tsx-sample.vue (copied).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, join } from 'node:path';
import { before, describe, it } from 'node:test';
import { pathToFileURL } from 'node:url';

import {
  resolveFromCore,
  type Instrumenter,
  type SourceFile,
} from '../src/install.ts';
import { defined } from './support/defined.ts';
import { exportedFunction } from './support/exports.ts';
import {
  instrumentFully,
  type InstrumentedMutant,
  type InstrumentResult,
} from './support/instrument-result.ts';
import { installInto, operatorNames, ours } from './support/installed.ts';

const root = join(import.meta.dirname, '..', '..', '..');
const corpus: readonly SourceFile[] = [
  join(root, 'spikes', 'design-opus', 'sample.tsx'),
  join(root, 'apps', 'demo-app', 'src', 'app', 'app.tsx'),
  join(root, 'apps', 'demo-app', 'src', 'app', 'price-tag.tsx'),
  join(import.meta.dirname, 'corpus', 'App.tsx'),
  join(import.meta.dirname, 'corpus', 'vue-tsx-sample.vue'),
].map((name) => ({ name, content: readFileSync(name, 'utf8') }));

let instrumenter: Instrumenter;
let parseTsx: (code: string) => unknown;
let stock: InstrumentResult[];
let excluded: InstrumentResult[];
let oneLeftOn: InstrumentResult[];
let on: InstrumentResult[];

const masked = (code: string): string =>
  code.replace(/(stryMutAct_9fa48|stryCov_9fa48)\([^)]*\)/g, '$1(#)');
const builtIns = (mutants: readonly InstrumentedMutant[]): string[] =>
  mutants
    .filter(({ mutatorName }) => !ours.has(mutatorName))
    .map(
      ({ location: { start }, mutatorName, replacement }) =>
        `${start.line}:${start.column} ${mutatorName} ${replacement}`,
    )
    .sort();

const firstContent = (result: InstrumentResult | undefined): string =>
  defined(defined(result).files[0]).content;

async function instrumentEach(excludedMutations: readonly string[]) {
  return Promise.all(
    corpus.map(async (file) =>
      instrumentFully(instrumenter, [file], excludedMutations),
    ),
  );
}

before(async () => {
  instrumenter = await resolveFromCore();
  const babelParse = exportedFunction(
    await import(
      pathToFileURL(
        createRequire(join(instrumenter.dir, 'package.json')).resolve(
          '@babel/parser',
        ),
      ).href
    ),
    'parse',
  );
  parseTsx = (code) =>
    Reflect.apply(babelParse, undefined, [
      code,
      { sourceType: 'module', plugins: ['typescript', 'jsx'] },
    ]);
  stock = await instrumentEach([]);
  await installInto(instrumenter);
  excluded = await instrumentEach(operatorNames);
  oneLeftOn = await instrumentEach(
    operatorNames.filter((name) => name !== 'LzJsxTextLiteral'),
  );
  on = await instrumentEach([]);
});

describe('the JSX placement, with every UI operator excluded', () => {
  corpus.forEach(({ name }, index) => {
    const file = basename(name);

    it(`gives the stock output once mutant ids are masked, for ${file}`, () => {
      assert.equal(
        masked(firstContent(excluded[index])),
        masked(firstContent(stock[index])),
      );
    });

    it(`gives the stock list of built-in mutants (line:col mutator replacement), for ${file}`, () => {
      assert.deepEqual(
        builtIns(defined(excluded[index]).mutants),
        builtIns(defined(stock[index]).mutants),
      );
    });
  });

  it('reports each excluded UI mutant as Ignored', () => {
    const ui = excluded.flatMap(({ mutants }) =>
      mutants.filter(({ mutatorName }) => ours.has(mutatorName)),
    );

    assert.ok(ui.length > 0);
    assert.deepEqual(
      new Set(ui.map(({ status }) => status)),
      new Set(['Ignored']),
    );
  });

  it('shows a difference when one UI operator is left unexcluded (the negative control)', () => {
    const differing = corpus.filter(
      (_file, index) =>
        masked(firstContent(oneLeftOn[index])) !==
        masked(firstContent(stock[index])),
    );

    assert.ok(differing.length > 0);
  });
});

describe('the JSX placement, with the UI operators on', () => {
  corpus.forEach(({ name }, index) => {
    if (name.endsWith('.tsx')) {
      it(`instruments ${basename(name)} to TSX that Babel parses again`, () => {
        assert.doesNotThrow(() => parseTsx(firstContent(on[index])));
      });
    }
  });

  it('gives the stock built-in mutants with the UI operators on, for each corpus file', () => {
    assert.deepEqual(
      on.map(({ mutants }) => builtIns(mutants)),
      stock.map(({ mutants }) => builtIns(mutants)),
    );
  });

  it('places an attribute mutant inside the attribute value, a text mutant as null, and an element switch among JSX children in braces', async () => {
    const { files } = await instrumentFully(instrumenter, [
      {
        name: 'placement.tsx',
        content:
          'export const a = <div><img alt="Logo" /><p>Hello</p><button>Go</button></div>;\n',
      },
    ]);
    const code = defined(files[0]).content;

    assert.match(
      code,
      /<img alt=\{stryMutAct_9fa48\("\d+"\) \? "" : \(stryCov_9fa48\("\d+"\), "Logo"\)\} \/>/,
    );
    assert.match(
      code,
      /<p>\{stryMutAct_9fa48\("\d+"\) \? null : \(stryCov_9fa48\("\d+"\), "Hello"\)\}<\/p>/,
    );
    assert.match(
      code,
      /<\/p>\{stryMutAct_9fa48\("\d+"\) \? <span>Go<\/span> : \(stryCov_9fa48\("\d+"\), <button>/,
    );
    assert.doesNotThrow(() => parseTsx(code));
  });

  it('places an attribute, a text and an element switch on one <a href> at once', async () => {
    const { files, mutants } = await instrumentFully(instrumenter, [
      {
        name: 'link.tsx',
        content: 'export const a = <p><a href="/x">X</a></p>;\n',
      },
    ]);

    assert.deepEqual(mutants.map(({ mutatorName }) => mutatorName).sort(), [
      'LzJsxElementRole',
      'LzJsxTextLiteral',
      'LzJsxUrlAttribute',
    ]);
    assert.doesNotThrow(() => parseTsx(defined(files[0]).content));
  });
});
