// Drives LzStrykerPlaywrightTestRunner against a TSX fixture instrumented with the UI operators of @layzee/stryker-playwright-mutators:
// for each operator, a Playwright test kills its mutant and a test that does not observe it lets it survive.
// Run: npx nx run @layzee/stryker-playwright-runner:test-browser
import '@layzee/stryker-playwright-mutators';

import assert from 'node:assert/strict';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import type { Location, Mutant } from '@stryker-mutator/api/core';
import { MutantRunStatus, TestStatus } from '@stryker-mutator/api/test-runner';
import { Instrumenter } from '@stryker-mutator/instrumenter';
import ts from 'typescript';

import { logger } from '../support/doubles.ts';
import { type Session, startSession, transpile } from './support/session.ts';

const fixture = (file: string) =>
  fileURLToPath(new URL(`./ui-fixture/${file}`, import.meta.url));
const { log } = logger();
const source = readFileSync(fixture('src/app.tsx'), 'utf8');
const sourceLines = source.split('\n');
const jsx = { jsx: ts.JsxEmit.React, jsxFactory: 'h' };

let session: Session;
let mutants: readonly Mutant[];

function textAt({ start, end }: Location): string {
  const last = end.line - start.line;

  return sourceLines
    .slice(start.line, end.line + 1)
    .map((line, i) =>
      line.slice(
        i === 0 ? start.column : 0,
        i === last ? end.column : undefined,
      ),
    )
    .join('\n');
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

  const [first] = found;
  assert.ok(first);

  return first;
}

function mutantRun(m: Mutant, title: string) {
  return session.mutantRun(m, { testFilter: [session.testId(title)] });
}

before(async () => {
  const result = await new Instrumenter(log).instrument(
    [{ name: fixture('src/app.tsx'), content: source, mutate: true }],
    { plugins: null, excludedMutations: [], ignorers: [] },
  );
  mutants = result.mutants;
  const [app] = result.files;
  assert.ok(app, 'the instrumented app');
  writeFileSync(fixture('public/app.js'), transpile(app.content, jsx));
  writeFileSync(
    fixture('public/h.js'),
    transpile(readFileSync(fixture('src/h.ts'), 'utf8'), jsx),
  );
  rmSync(fixture('test-results'), { recursive: true, force: true });

  session = await startSession(
    fixture('playwright.config.ts'),
    fixture('src/app.tsx'),
    log,
  );
});

after(async () => {
  await session?.dispose();
});

test('dry run completes with every test passing', () => {
  const { tests } = session.dryRun;

  assert.equal(tests.length, 10, JSON.stringify(tests));
  assert.ok(
    tests.every((t) => t.status === TestStatus.Success),
    JSON.stringify(tests),
  );
});

test('per-test coverage credits a text mutant only to the tests that render its element', () => {
  const { perTest, static: staticCoverage } = session.mutantCoverage;
  const heading = mutant('LzTextLiteral', 'Orders', '').id;
  const status = mutant('LzTextLiteral', 'Revealed', '').id;

  assert.ok(perTest[session.testId('shows the heading')]?.[heading]);
  assert.ok(perTest[session.testId('reveals the status')]?.[heading]);
  assert.ok(perTest[session.testId('reveals the status')]?.[status]);
  assert.equal(
    perTest[session.testId('shows the heading')]?.[status],
    undefined,
  );
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
    operator: 'LzTextLiteral',
    original: 'Orders',
    replacement: '',
    killer: 'shows the heading',
    bystander: 'shows the total',
  },
  {
    operator: 'LzLabelAttribute',
    original: 'aria-label="Close"',
    replacement: 'aria-label=""',
    killer: 'closes the dialog',
    bystander: 'toggle reports expanded',
  },
  {
    operator: 'LzEventHandler',
    original: 'onClick={actions.reveal}',
    replacement: 'onClick={undefined}',
    killer: 'reveals the status',
    bystander: 'shows the heading',
  },
  {
    operator: 'LzConditionalElement',
    original: 'open && <p>Details panel</p>',
    replacement: '<p>Details panel</p>',
    killer: 'panel starts hidden',
    bystander: 'shows the heading',
  },
  {
    operator: 'LzUrlAttribute',
    original: 'href="#/done"',
    replacement: 'href=""',
    killer: 'navigates to done',
    bystander: 'shows the heading',
  },
  {
    operator: 'LzDisabledAttribute',
    original: 'disabled={busy}',
    replacement: 'disabled={false}',
    killer: 'submit is disabled while busy',
    bystander: 'shows the heading',
  },
  {
    operator: 'LzHiddenAttribute',
    original: 'hidden={!open}',
    replacement: 'hidden={false}',
    killer: 'region hidden until opened',
    bystander: 'shows the heading',
  },
  {
    operator: 'LzElementRole',
    original: 'role="dialog"',
    replacement: 'role={undefined}',
    killer: 'opens the dialog',
    bystander: 'toggle reports expanded',
  },
  {
    operator: 'LzChildExpression',
    original: 'total',
    replacement: 'null',
    killer: 'shows the total',
    bystander: 'shows the heading',
  },
  {
    operator: 'LzStateAttribute',
    original: 'aria-expanded={open}',
    replacement: 'aria-expanded={!open}',
    killer: 'toggle reports expanded',
    bystander: 'shows the heading',
  },
];

rows.forEach(({ operator, original, replacement, killer, bystander }) => {
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
    assert.deepEqual(result.killedBy, [session.testId(killer)]);
  });
});
