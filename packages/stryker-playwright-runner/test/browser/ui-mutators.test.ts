// Drives PlaywrightTestRunner against a TSX fixture instrumented with the UI operators of @layzee/stryker-ui-mutators:
// for each operator, a Playwright test kills its mutant and a test that does not observe it lets it survive.
// Run: npx nx run @layzee/stryker-playwright-runner:test-browser
import '@layzee/stryker-ui-mutators';

import assert from 'node:assert/strict';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import type {
  Location,
  Mutant,
  StrykerOptions,
} from '@stryker-mutator/api/core';
import type { Logger } from '@stryker-mutator/api/logging';
import {
  type CompleteDryRunResult,
  DryRunStatus,
  MutantRunStatus,
  type TestResult,
  TestStatus,
} from '@stryker-mutator/api/test-runner';
import { Instrumenter } from '@stryker-mutator/instrumenter';
import ts from 'typescript';

import { PlaywrightTestRunner } from '../../src/playwright-test-runner.ts';

const fixture = (file: string) =>
  fileURLToPath(new URL(`./ui-fixture/${file}`, import.meta.url));
const nothing = () => undefined;
const log = {
  ...Object.fromEntries(
    ['trace', 'debug', 'info', 'warn', 'error', 'fatal'].map((level) => [
      level,
      nothing,
    ]),
  ),
  isDebugEnabled: () => false,
} as unknown as Logger;
const source = readFileSync(fixture('src/app.tsx'), 'utf8');
const sourceLines = source.split('\n');

let runner: PlaywrightTestRunner;
let mutants: readonly Mutant[];
let dryRun: CompleteDryRunResult;
let tests: TestResult[];

function textAt({ start, end }: Location): string {
  const lines = sourceLines.slice(start.line, end.line + 1);
  lines[lines.length - 1] = lines[lines.length - 1]!.slice(0, end.column);
  lines[0] = lines[0]!.slice(start.column);

  return lines.join('\n');
}

/** The one mutant of `mutatorName` at the source text `original`, with `replacement`. */
function mutant(
  mutatorName: string,
  original: string,
  replacement: string,
): Mutant {
  const found = mutants.filter(
    (m) =>
      m.mutatorName === mutatorName &&
      m.replacement === replacement &&
      textAt(m.location) === original,
  );
  assert.equal(
    found.length,
    1,
    `one ${mutatorName} mutant ${original} -> ${replacement}`,
  );

  return found[0]!;
}

function testId(title: string): string {
  const found = tests.find((t) => t.name.endsWith(title));
  assert.ok(found, `test "${title}" exists`);

  return found.id;
}

function mutantRun(m: Mutant, title: string) {
  return runner.mutantRun({
    activeMutant: m,
    testFilter: [testId(title)],
    timeout: 60_000,
    disableBail: false,
    mutantActivation: 'runtime',
    reloadEnvironment: false,
    sandboxFileName: fixture('src/app.tsx'),
  });
}

function transpile(code: string): string {
  return ts.transpileModule(code, {
    compilerOptions: {
      jsx: ts.JsxEmit.React,
      jsxFactory: 'h',
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
}

before(async () => {
  const result = await new Instrumenter(log).instrument(
    [{ name: fixture('src/app.tsx'), content: source, mutate: true }],
    { plugins: null, excludedMutations: [], ignorers: [] },
  );
  mutants = result.mutants;
  writeFileSync(fixture('public/app.js'), transpile(result.files[0]!.content));
  writeFileSync(
    fixture('public/h.js'),
    transpile(readFileSync(fixture('src/h.ts'), 'utf8')),
  );
  rmSync(fixture('test-results'), { recursive: true, force: true });

  const options = {
    playwright: { configFile: fixture('playwright.config.ts') },
    timeoutMS: 10_000,
  };
  runner = new PlaywrightTestRunner(options as unknown as StrykerOptions, log);
  await runner.init();

  const dry = await runner.dryRun({
    timeout: 60_000,
    disableBail: false,
    coverageAnalysis: 'perTest',
  });
  assert.equal(dry.status, DryRunStatus.Complete, JSON.stringify(dry));
  dryRun = dry;
  tests = dryRun.tests;
});

after(async () => {
  await runner?.dispose();
});

test('dry run completes with every test passing', () => {
  assert.equal(tests.length, 10, JSON.stringify(tests));
  assert.ok(
    tests.every((t) => t.status === TestStatus.Success),
    JSON.stringify(tests),
  );
});

test('per-test coverage credits a text mutant only to the tests that render its element', () => {
  const { perTest, static: staticCoverage } = dryRun.mutantCoverage!;
  const heading = mutant('TextLiteral', 'Orders', '').id;
  const status = mutant('TextLiteral', 'Revealed', '').id;

  assert.ok(perTest[testId('shows the heading')]?.[heading]);
  assert.ok(perTest[testId('reveals the status')]?.[heading]);
  assert.ok(perTest[testId('reveals the status')]?.[status]);
  assert.equal(perTest[testId('shows the heading')]?.[status], undefined);
  assert.equal(staticCoverage[status], undefined);
});

const rows: readonly {
  operator: string;
  original: string;
  replacement: string;
  killer: string;
  bystander: string;
}[] = [
  {
    operator: 'TextLiteral',
    original: 'Orders',
    replacement: '',
    killer: 'shows the heading',
    bystander: 'shows the total',
  },
  {
    operator: 'LabelAttribute',
    original: 'aria-label="Close"',
    replacement: 'aria-label=""',
    killer: 'closes the dialog',
    bystander: 'toggle reports expanded',
  },
  {
    operator: 'EventHandler',
    original: 'onClick={actions.reveal}',
    replacement: 'onClick={undefined}',
    killer: 'reveals the status',
    bystander: 'shows the heading',
  },
  {
    operator: 'ConditionalElement',
    original: 'open && <p>Details panel</p>',
    replacement: '<p>Details panel</p>',
    killer: 'panel starts hidden',
    bystander: 'shows the heading',
  },
  {
    operator: 'UrlAttribute',
    original: 'href="#/done"',
    replacement: 'href=""',
    killer: 'navigates to done',
    bystander: 'shows the heading',
  },
  {
    operator: 'DisabledAttribute',
    original: 'disabled={busy}',
    replacement: 'disabled={false}',
    killer: 'submit is disabled while busy',
    bystander: 'shows the heading',
  },
  {
    operator: 'HiddenAttribute',
    original: 'hidden={!open}',
    replacement: 'hidden={false}',
    killer: 'region hidden until opened',
    bystander: 'shows the heading',
  },
  {
    operator: 'ElementRole',
    original: 'role="dialog"',
    replacement: 'role={undefined}',
    killer: 'opens the dialog',
    bystander: 'toggle reports expanded',
  },
  {
    operator: 'ChildExpression',
    original: 'total',
    replacement: 'null',
    killer: 'shows the total',
    bystander: 'shows the heading',
  },
  {
    operator: 'StateAttribute',
    original: 'aria-expanded={open}',
    replacement: 'aria-expanded={!open}',
    killer: 'toggle reports expanded',
    bystander: 'shows the heading',
  },
];

for (const { operator, original, replacement, killer, bystander } of rows) {
  const change = `${original} -> ${replacement || 'empty text'}`;

  test(`${operator}: "${bystander}" does not observe ${change}, so it survives`, async () => {
    const result = await mutantRun(
      mutant(operator, original, replacement),
      bystander,
    );

    assert.equal(
      result.status,
      MutantRunStatus.Survived,
      JSON.stringify(result),
    );
  });

  test(`${operator}: "${killer}" kills ${change}`, async () => {
    const result = await mutantRun(
      mutant(operator, original, replacement),
      killer,
    );

    assert.equal(result.status, MutantRunStatus.Killed, JSON.stringify(result));
    assert.deepEqual(result.killedBy, [testId(killer)]);
  });
}
