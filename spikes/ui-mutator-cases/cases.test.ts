// Synthetic operator cases: each UI shape from the OSS repos must give exactly the UI mutants the design names.
// Runs against the design spike's prototype until the operators package exists.
// Run: node --test spikes/ui-mutator-cases/cases.test.ts
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { install } from '../design-opus/ui-mutators.ts';
import { type Case, cases, type Operator } from './cases.ts';

// The prototype predates the approved names (docs/design/playwright-mutators.md, Names).
const APPROVED: Record<string, Operator> = {
  TextContent: 'TextLiteral',
  AccessibleName: 'LabelAttribute',
  EventHandler: 'EventHandler',
  ConditionalRendering: 'ConditionalElement',
  NavigationTarget: 'UrlAttribute',
  DisabledState: 'DisabledAttribute',
  HiddenState: 'HiddenAttribute',
  Role: 'ElementRole',
  ChildExpression: 'ChildExpression',
  AriaState: 'StateAttribute',
};

const projectRoot = join(fileURLToPath(new URL('.', import.meta.url)), '../..');
const { dir } = await install(projectRoot);
const { Instrumenter } = (await import(
  pathToFileURL(join(dir, 'dist/src/index.js')).href
)) as {
  Instrumenter: new (logger: object) => {
    instrument(
      files: { name: string; content: string; mutate: boolean }[],
      options: object,
    ): Promise<{
      mutants: { fileName: string; mutatorName: string; replacement: string }[];
    }>;
  };
};
const silent = () => {};
const logger = {
  isDebugEnabled: () => false,
  isTraceEnabled: () => false,
  debug: silent,
  info: silent,
  warn: silent,
  error: silent,
  trace: silent,
  fatal: silent,
};

function source(testCase: Case): string {
  return `${testCase.setup ?? ''}\nexport function Case(props: any) {\n  return (${testCase.jsx});\n}\n`;
}

function normalize(code: string): string {
  return code.replace(/\s+/g, ' ').trim();
}

const files = cases.map((testCase) => ({
  name: join(projectRoot, 'spikes/ui-mutator-cases/out', `${testCase.id}.tsx`),
  content: source(testCase),
  mutate: true,
}));
const { mutants } = await new Instrumenter(logger).instrument(files, {
  plugins: null,
  excludedMutations: [],
  ignorers: [],
});

for (const [index, testCase] of cases.entries()) {
  const options = testCase.gap ? { todo: testCase.gap } : {};

  test(`${testCase.id}: ${testCase.title}`, options, () => {
    const actual = mutants
      .filter(({ fileName }) => fileName === files[index]!.name)
      .filter(({ mutatorName }) => mutatorName in APPROVED)
      .map(
        ({ mutatorName, replacement }) =>
          `${APPROVED[mutatorName]} ${normalize(replacement)}`,
      )
      .sort();
    const expected = testCase.expect
      .map(([operator, replacement]) => `${operator} ${normalize(replacement)}`)
      .sort();

    assert.deepEqual(actual, expected, `origin ${testCase.origin}`);
  });
}
