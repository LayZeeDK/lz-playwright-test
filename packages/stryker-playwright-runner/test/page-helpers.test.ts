import assert from 'node:assert/strict';
import { test } from 'node:test';
import vm from 'node:vm';

import {
  loadPageHelpers,
  pageHelpersFrom,
  pageHelpersScript,
  StrykerHelpersChanged,
} from '../src/page-helpers.ts';

/** Runs an init script as Playwright does, inside a function, in a fresh global scope. */
function initScriptRun(script: string): Record<string, unknown> {
  const page: Record<string, unknown> = {};
  vm.runInNewContext(`(() => {\n${script}\n})();`, page);

  return page;
}

test('the init script publishes the functions the header declares on globalThis', () => {
  const page = initScriptRun(
    pageHelpersScript(
      'function one() {\n  return 1;\n}\nfunction two() {\n  return 2;\n}\nlzStrykerProbe = one("0");\n',
    ),
  );
  assert.equal(
    vm.runInContext('`${globalThis.one()} ${globalThis.two()}`', page),
    '1 2',
  );
});

test('the init script leaves out the probe statement', () => {
  const page = initScriptRun(
    pageHelpersScript(
      'function one() {\n  return 1;\n}\nlzStrykerProbe = one("0");\n',
    ),
  );

  assert.equal('lzStrykerProbe' in page, false);
});

test('a probe that calls a function the header does not declare refuses to start, naming it', () => {
  assert.throws(
    () =>
      pageHelpersScript(
        'function one() {\n  return 1;\n}\nlzStrykerProbe = other("0") ? 0 : (one("0"), 1);\n',
      ),
    (error) =>
      error instanceof StrykerHelpersChanged &&
      /calls other, which the header does not declare/.test(error.message),
  );
});

test("with the installed instrumenter's helpers, a page covers a callback mutant and switches it on", async () => {
  const script = await loadPageHelpers();
  const instrumentedCallback =
    '(() => stryMutAct_9fa48("0") ? 1 - 1 : (stryCov_9fa48("0"), 1 + 1))()';
  const covering = initScriptRun(script);
  const switched = initScriptRun(
    `globalThis.__stryker__ = { activeMutant: "0" };\n${script}`,
  );

  assert.equal(vm.runInContext(instrumentedCallback, covering), 2);
  assert.equal(
    JSON.stringify(vm.runInContext('__stryker__.mutantCoverage', covering)),
    '{"static":{"0":1},"perTest":{}}',
  );
  assert.equal(vm.runInContext(instrumentedCallback, switched), 0);
});

test('an instrumented probe without its probe statement refuses to start', () => {
  assert.throws(
    () => pageHelpersScript('function one() {}\nother = one("0");\n'),
    (error) =>
      error instanceof StrykerHelpersChanged &&
      /no probe statement/.test(error.message),
  );
});

[
  { instrumenterModule: {}, refusal: 'it exports no Instrumenter class' },
  {
    instrumenterModule: { Instrumenter: class {} },
    refusal: 'its Instrumenter has no instrument method',
  },
  {
    instrumenterModule: {
      Instrumenter: class {
        instrument() {
          return { files: [] };
        }
      },
    },
    refusal: 'its Instrumenter returned no instrumented file',
  },
].forEach(({ instrumenterModule, refusal }) => {
  test(`an instrumenter module where ${refusal} refuses to start, saying so`, async () => {
    await assert.rejects(
      pageHelpersFrom(instrumenterModule),
      (error) =>
        error instanceof StrykerHelpersChanged &&
        error.message.includes(`(${refusal})`),
    );
  });
});

test('a probe statement with no header before it refuses to start for the missing helpers', () => {
  assert.throws(
    () => pageHelpersScript('lzStrykerProbe = 1 + 1;\n'),
    (error) =>
      error instanceof StrykerHelpersChanged &&
      /declares no helper function/.test(error.message),
  );
});

test('a header that declares no function refuses to start', () => {
  assert.throws(
    () => pageHelpersScript('ns();\nlzStrykerProbe = 1 + 1;\n'),
    (error) =>
      error instanceof StrykerHelpersChanged &&
      /declares no helper function/.test(error.message),
  );
});
