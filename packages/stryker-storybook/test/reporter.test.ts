import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { describe, it, type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';

import { PlanKind, type schema } from '@stryker-mutator/api/core';

import { isRecord } from '../src/is-record.ts';
import { storybookReporter } from '../src/reporter.ts';
import { appendRecord, recordVariable } from '../src/stryker-record.ts';
import { describeVerdict, spyStubReason } from '../src/stub-verdict.ts';
import recorded from './fixtures/reporter/mutation.json' with { type: 'json' };

const fixtures = fileURLToPath(new URL('fixtures/', import.meta.url));

const mutantStatuses = [
  'Killed',
  'Survived',
  'NoCoverage',
  'CompileError',
  'RuntimeError',
  'Timeout',
  'Ignored',
  'Pending',
] as const satisfies readonly schema.MutantStatus[];

function mutantStatus(value: string): schema.MutantStatus {
  const status = mutantStatuses.find((candidate) => candidate === value);

  if (status === undefined) {
    throw new Error(`mutation.json has an unknown mutant status: ${value}`);
  }

  return status;
}

const recordedReport = {
  files: Object.fromEntries(
    Object.entries(recorded.files).map(([file, { source, mutants }]) => [
      file,
      {
        source,
        mutants: mutants.map((mutant) => ({
          ...mutant,
          status: mutantStatus(mutant.status),
        })),
      },
    ]),
  ),
};

const erasedStub = [
  "import { fn } from 'storybook/test';",
  '',
  "export default { args: { onClick: fn().mockReturnValue('stubbed') } };",
  '',
  'export const Primary = {};',
  '',
].join('\n');

function commentedStub(comment: string): string {
  return [
    "import { fn } from 'storybook/test';",
    '',
    'export default {',
    `  ${comment}`,
    "  args: { onClick: fn().mockReturnValue('stubbed') },",
    '};',
    '',
    'export const Primary = {};',
    '',
  ].join('\n');
}

const literalStub = [
  "import { fn } from 'storybook/test';",
  '',
  'export default {',
  "  args: { getValue: fn().mockReturnValue({ label: 'stubbed', count: 1 + 1 }) },",
  '};',
  '',
  'export const Primary = {};',
  '',
].join('\n');

function ignoredAt(source: string, text: string, mutatorName: string) {
  const lines = source.split('\n');
  const line = lines.findIndex((candidate) => candidate.includes(text)) + 1;
  const column = (lines[line - 1] ?? '').indexOf(text) + 1;

  return {
    mutatorName,
    status: 'Ignored',
    statusReason: spyStubReason('erased'),
    location: {
      start: { line, column },
      end: { line, column: column + text.length },
    },
  } as const;
}

function writeStory(projectDir: string, name: string, content: string): void {
  mkdirSync(join(projectDir, 'src'), { recursive: true });
  writeFileSync(join(projectDir, 'src', name), content);
}

function runPlan(fileName: string, line: number, isStatic = true) {
  return {
    plan: PlanKind.Run,
    netTime: 362,
    mutant: {
      fileName,
      mutatorName: 'LzStorybookSpyStub',
      static: isStatic,
      location: { start: { line, column: 1 }, end: { line, column: 2 } },
    },
  } as const;
}

function setup(t: TestContext, fixture = 'no-main', options: object = {}) {
  const previousDir = process.cwd();
  const projectDir = mkdtempSync(join(tmpdir(), 'lz-storybook-reporter-'));
  const previousRecord = process.env[recordVariable];
  process.chdir(projectDir);
  t.after(() => {
    process.chdir(previousDir);

    if (previousRecord === undefined) {
      delete process.env[recordVariable];
    } else {
      process.env[recordVariable] = previousRecord;
    }
  });
  const lines: string[] = [];
  const reporter = storybookReporter(
    {
      ...options,
      lzStorybook: { configDir: join(fixtures, fixture, '.storybook') },
    },
    {
      info: (message) => lines.push(`info: ${message}`),
      warn: (message) => lines.push(`warn: ${message}`),
    },
  );

  const written = (): unknown =>
    JSON.parse(
      readFileSync(join(projectDir, 'reports', 'lz-storybook.json'), 'utf8'),
    );

  return {
    reporter,
    lines,
    consoleBlock: (): readonly string[] => (lines.at(-1) ?? '').split('\n'),
    projectDir,
    written,
    findings: (): readonly unknown[] => {
      const report = written();

      if (!isRecord(report) || !Array.isArray(report['findings'])) {
        throw new Error(
          `The report holds no findings array: ${JSON.stringify(report)}`,
        );
      }

      return report['findings'];
    },
  };
}

describe('storybookReporter', () => {
  it('writes an empty report when the run has no story findings', (t) => {
    const { reporter, written } = setup(t);

    reporter.onMutationTestReportReady({ files: {} });

    assert.deepEqual(written(), { findings: [], staticStoryMutants: [] });
  });

  it('reports an erased stub in a story file in the mutation report', (t) => {
    const { reporter, findings } = setup(t);

    reporter.onMutationTestReportReady(recordedReport);

    assert.deepEqual(
      findings().filter(
        (finding) => isRecord(finding) && finding['verdict'] === 'erased',
      ),
      [
        {
          file: 'src/SpyStubDefault.stories.tsx',
          line: 15,
          ...describeVerdict('erased'),
        },
      ],
    );
  });

  it('reports the order-dependent and unknown stubs with their files and lines', (t) => {
    const { reporter, findings } = setup(t);

    reporter.onMutationTestReportReady(recordedReport);

    assert.deepEqual(
      findings().filter(
        (finding) =>
          isRecord(finding) &&
          (finding['verdict'] === 'order-dependent' ||
            finding['verdict'] === 'unknown'),
      ),
      [
        {
          file: 'src/lzsb/Imported.stories.tsx',
          line: 14,
          ...describeVerdict('unknown'),
        },
        {
          file: 'src/lzsb/OrderDep.stories.tsx',
          line: 13,
          ...describeVerdict('order-dependent'),
        },
      ],
    );
  });

  it('reports a stub once, whatever the number of its Ignored mutants', (t) => {
    const { reporter, findings } = setup(t);

    reporter.onMutationTestReportReady({
      files: {
        'src/Literal.stories.tsx': {
          source: literalStub,
          mutants: [
            ignoredAt(literalStub, "{ label: 'stubbed'", 'ObjectLiteral'),
            ignoredAt(literalStub, "'stubbed'", 'StringLiteral'),
            ignoredAt(literalStub, '1 + 1', 'ArithmeticOperator'),
          ],
        },
      },
    });

    assert.deepEqual(findings(), [
      {
        file: 'src/Literal.stories.tsx',
        line: 4,
        ...describeVerdict('erased'),
      },
    ]);
  });

  it('leaves out a stub in a mutation report file that is no story file', (t) => {
    const { reporter, findings } = setup(t);

    reporter.onMutationTestReportReady({
      files: { 'src/meta.ts': { source: erasedStub, mutants: [] } },
    });

    assert.deepEqual(findings(), []);
  });

  it('reports a stub that holds no mutant in a story file in the mutation report', (t) => {
    const { reporter, findings } = setup(t);
    const source = erasedStub.replace("'stubbed'", '42');

    reporter.onMutationTestReportReady({
      files: { 'src/Meta.stories.tsx': { source, mutants: [] } },
    });

    assert.deepEqual(findings(), [
      {
        file: 'src/Meta.stories.tsx',
        line: 3,
        ...describeVerdict('erased'),
      },
    ]);
  });

  it('leaves out a reported stub under a disable next-line comment naming the spy stub mutator', (t) => {
    const { reporter, findings } = setup(t);
    const source = literalStub.replace(
      '  args:',
      '  // Stryker disable next-line LzStorybookSpyStub\n  args:',
    );

    reporter.onMutationTestReportReady({
      files: {
        'src/Literal.stories.tsx': {
          source,
          mutants: [ignoredAt(source, "'stubbed'", 'StringLiteral')],
        },
      },
    });

    assert.deepEqual(findings(), []);
  });

  it('leaves out a reported stub when the spy stub mutator is in excludedMutations', (t) => {
    const { reporter, findings } = setup(t, 'no-main', {
      mutator: { excludedMutations: ['LzStorybookSpyStub'] },
    });

    reporter.onMutationTestReportReady({
      files: {
        'src/Literal.stories.tsx': {
          source: literalStub,
          mutants: [ignoredAt(literalStub, "'stubbed'", 'StringLiteral')],
        },
      },
    });

    assert.deepEqual(findings(), []);
  });

  it('reports a Survived spy stub mutant as an unchecked stub', (t) => {
    const { reporter, findings } = setup(t);

    reporter.onMutationTestReportReady(recordedReport);

    assert.deepEqual(
      findings().filter(
        (finding) => isRecord(finding) && finding['verdict'] === 'unchecked',
      ),
      [
        {
          file: 'src/SpyStubMetaOff.stories.tsx',
          line: 24,
          verdict: 'unchecked',
          reason:
            'no test fails without this stub, so no play checks what it changes',
          fix: 'assert in the play what the stubbed value changes',
        },
      ],
    );
  });

  it('reports no finding for a Killed spy stub or a mutant ignored for another reason', (t) => {
    const { reporter, findings } = setup(t);

    reporter.onMutationTestReportReady(recordedReport);

    assert.deepEqual(
      findings().map((finding) => isRecord(finding) && finding['verdict']),
      ['unknown', 'order-dependent', 'erased', 'unchecked'],
    );
  });

  it('lists a static story mutant with its 1-based line and net time', (t) => {
    const { reporter, written, projectDir } = setup(t);

    reporter.onMutationTestingPlanReady({
      mutantPlans: [
        runPlan(join(projectDir, 'src', 'SpyStubMetaOff.stories.tsx'), 16),
      ],
    });
    reporter.onMutationTestReportReady({ files: {} });

    assert.deepEqual(written(), {
      findings: [],
      staticStoryMutants: [
        {
          file: 'src/SpyStubMetaOff.stories.tsx',
          line: 17,
          mutatorName: 'LzStorybookSpyStub',
          netTime: 362,
        },
      ],
    });
  });

  it('leaves a mutant that is not static out of the static list', (t) => {
    const { reporter, written, projectDir } = setup(t);

    reporter.onMutationTestingPlanReady({
      mutantPlans: [
        runPlan(
          join(projectDir, 'src', 'SpyStubMetaOff.stories.tsx'),
          16,
          false,
        ),
      ],
    });
    reporter.onMutationTestReportReady({ files: {} });

    assert.deepEqual(written(), { findings: [], staticStoryMutants: [] });
  });

  it('leaves a static mutant outside story files out of the static list', (t) => {
    const { reporter, written, projectDir } = setup(t);

    reporter.onMutationTestingPlanReady({
      mutantPlans: [runPlan(join(projectDir, 'src', 'Button.tsx'), 3)],
    });
    reporter.onMutationTestReportReady({ files: {} });

    assert.deepEqual(written(), { findings: [], staticStoryMutants: [] });
  });

  it('leaves a static mutant with an early result out of the static list', (t) => {
    const { reporter, written, projectDir } = setup(t);
    const { mutant } = runPlan(
      join(projectDir, 'src', 'SpyStubMetaOff.stories.tsx'),
      16,
    );

    reporter.onMutationTestingPlanReady({
      mutantPlans: [{ plan: PlanKind.EarlyResult, mutant }],
    });
    reporter.onMutationTestReportReady({ files: {} });

    assert.deepEqual(written(), { findings: [], staticStoryMutants: [] });
  });

  it('opens its console block with the finding counts per verdict', (t) => {
    const { reporter, consoleBlock } = setup(t);

    reporter.onMutationTestReportReady(recordedReport);

    assert.equal(
      consoleBlock()[0],
      'info: @layzee/stryker-storybook: 4 spy stub findings (1 unknown, 1 order-dependent, 1 erased, 1 unchecked)',
    );
  });

  it('prints one line per finding with its verdict, place, cause and fix', (t) => {
    const { reporter, consoleBlock } = setup(t);
    const erased = describeVerdict('erased');

    reporter.onMutationTestReportReady(recordedReport);

    assert.equal(
      consoleBlock()[3],
      `  erased  src/SpyStubDefault.stories.tsx:15  ${erased.reason}; ${erased.fix}`,
    );
  });

  it('closes its console block with the static story mutant count', (t) => {
    const { reporter, consoleBlock, projectDir } = setup(t);

    reporter.onMutationTestingPlanReady({
      mutantPlans: [
        runPlan(join(projectDir, 'src', 'SpyStubMetaOff.stories.tsx'), 16),
        runPlan(join(projectDir, 'src', 'SpyStubMetaOff.stories.tsx'), 23),
      ],
    });
    reporter.onMutationTestReportReady(recordedReport);

    assert.equal(
      consoleBlock().at(-1),
      '  static story mutants: 2, each runs every test; net times in reports/lz-storybook.json',
    );
  });

  it('prints one line saying so when the run has no story findings', (t) => {
    const { reporter, consoleBlock } = setup(t);

    reporter.onMutationTestReportReady({ files: {} });

    assert.deepEqual(consoleBlock(), [
      'info: @layzee/stryker-storybook: no spy stub findings and no static story mutants',
    ]);
  });

  it('leaves the static line out when the run has no static story mutant', (t) => {
    const { reporter, consoleBlock } = setup(t);

    reporter.onMutationTestReportReady(recordedReport);

    assert.equal(consoleBlock().length, 5);
  });

  it('says there are no findings above the static line when only static mutants exist', (t) => {
    const { reporter, consoleBlock, projectDir } = setup(t);

    reporter.onMutationTestingPlanReady({
      mutantPlans: [
        runPlan(join(projectDir, 'src', 'SpyStubMetaOff.stories.tsx'), 16),
      ],
    });
    reporter.onMutationTestReportReady({ files: {} });

    assert.equal(
      consoleBlock()[0],
      'info: @layzee/stryker-storybook: no spy stub findings',
    );
  });

  it('points the transformer record variable at an absolute path when created', (t) => {
    setup(t);

    assert.equal(isAbsolute(process.env[recordVariable] ?? ''), true);
  });

  it('warns once when the transformer rewrote stubs that Storybook did not show it for', (t) => {
    const { reporter, lines, projectDir } = setup(t);
    appendRecord(join(projectDir, 'src', 'Stub.stories.tsx'), 1);

    reporter.onDryRunCompleted();

    assert.deepEqual(
      lines.filter((line) => line.startsWith('warn: ')),
      [
        "warn: @layzee/stryker-storybook: the mock transformer rewrote stubs during the dry run, but the Storybook main file's viteFinal does not add lzStorybookMockTransformerPlugin(), so the lz-storybook ignorer treated repaired stubs as erased; add the plugin through viteFinal",
      ],
    );
  });

  it('warns once when Storybook shows the transformer but it rewrote no stub', (t) => {
    const { reporter, lines } = setup(t, 'transformer');

    reporter.onDryRunCompleted();

    assert.deepEqual(
      lines.filter((line) => line.startsWith('warn: ')),
      [
        "warn: @layzee/stryker-storybook: the Storybook main file's viteFinal adds lzStorybookMockTransformerPlugin(), but it rewrote no stub during the dry run, so the lz-storybook ignorer may have kept stubs that the mock reset erases; check that the test run uses the Storybook Vite config, or ignore this if no story file stubs a spy outside a function",
      ],
    );
  });

  it('stays quiet when Storybook shows the transformer and it rewrote stubs', (t) => {
    const { reporter, lines, projectDir } = setup(t, 'transformer');
    appendRecord(join(projectDir, 'src', 'Stub.stories.tsx'), 1);

    reporter.onDryRunCompleted();

    assert.deepEqual(
      lines.filter((line) => line.startsWith('warn: ')),
      [],
    );
  });

  it('reports an erased stub in a story file absent from the mutation report', (t) => {
    const { reporter, findings, projectDir } = setup(t);
    writeStory(projectDir, 'Meta.stories.tsx', erasedStub);

    reporter.onMutationTestReportReady({ files: {} });

    assert.deepEqual(findings(), [
      {
        file: 'src/Meta.stories.tsx',
        line: 3,
        ...describeVerdict('erased'),
      },
    ]);
  });

  it("leaves out a stub that only a story outside the tag filter of Stryker's Vitest config erases", (t) => {
    const { reporter, findings, projectDir } = setup(t, 'no-main', {
      vitest: {
        configFile: join(fixtures, 'vitest-tags', 'vitest.config.ts'),
      },
    });
    writeStory(
      projectDir,
      'Tags.stories.tsx',
      [
        "import { fn } from 'storybook/test';",
        'export default { parameters: { test: { restoreMocks: false } } };',
        "export const A = { tags: ['flaky'], parameters: { test: { mockReset: true } } };",
        "export const B = { args: { g: fn().mockReturnValue('stubbed') } };",
      ].join('\n'),
    );

    reporter.onMutationTestReportReady({ files: {} });

    assert.deepEqual(findings(), []);
  });

  it('prints a scanned finding in its console block', (t) => {
    const { reporter, consoleBlock, projectDir } = setup(t);
    const erased = describeVerdict('erased');
    writeStory(projectDir, 'Meta.stories.tsx', erasedStub);

    reporter.onMutationTestReportReady({ files: {} });

    assert.deepEqual(consoleBlock(), [
      'info: @layzee/stryker-storybook: 1 spy stub findings (1 erased)',
      `  erased  src/Meta.stories.tsx:3  ${erased.reason}; ${erased.fix}`,
    ]);
  });

  it('reads a story file in the mutation report from the report, not from disk', (t) => {
    const { reporter, findings, projectDir } = setup(t);
    writeStory(projectDir, 'Meta.stories.tsx', erasedStub);

    reporter.onMutationTestReportReady({
      files: {
        'src/Meta.stories.tsx': { source: `\n${erasedStub}`, mutants: [] },
      },
    });

    assert.deepEqual(
      findings().map((finding) => isRecord(finding) && finding['line']),
      [4],
    );
  });

  it('leaves out a scanned stub under a disable next-line comment naming the spy stub mutator', (t) => {
    const { reporter, findings, projectDir } = setup(t);
    writeStory(
      projectDir,
      'Meta.stories.tsx',
      commentedStub(
        '// Stryker disable next-line LzStorybookSpyStub: kept on purpose',
      ),
    );

    reporter.onMutationTestReportReady({ files: {} });

    assert.deepEqual(findings(), []);
  });

  it('leaves out a scanned stub under a disable next-line all comment', (t) => {
    const { reporter, findings, projectDir } = setup(t);
    writeStory(
      projectDir,
      'Meta.stories.tsx',
      commentedStub('// Stryker disable next-line all'),
    );

    reporter.onMutationTestReportReady({ files: {} });

    assert.deepEqual(findings(), []);
  });

  it('leaves out a scanned stub below a disable comment without next-line', (t) => {
    const { reporter, findings, projectDir } = setup(t);
    writeStory(
      projectDir,
      'Meta.stories.tsx',
      `// Stryker disable LzStorybookSpyStub\n${erasedStub}`,
    );

    reporter.onMutationTestReportReady({ files: {} });

    assert.deepEqual(findings(), []);
  });

  it('reports a scanned stub below a restore comment that ends a disable', (t) => {
    const { reporter, findings, projectDir } = setup(t);
    writeStory(
      projectDir,
      'Meta.stories.tsx',
      `// Stryker disable LzStorybookSpyStub\n${commentedStub('// Stryker restore all')}`,
    );

    reporter.onMutationTestReportReady({ files: {} });

    assert.deepEqual(
      findings().map((finding) => isRecord(finding) && finding['verdict']),
      ['erased'],
    );
  });

  it('leaves out a scanned stub under a disable comment listing the mutator in lower case among others', (t) => {
    const { reporter, findings, projectDir } = setup(t);
    writeStory(
      projectDir,
      'Meta.stories.tsx',
      commentedStub(
        '// Stryker disable next-line StringLiteral, lzstorybookspystub',
      ),
    );

    reporter.onMutationTestReportReady({ files: {} });

    assert.deepEqual(findings(), []);
  });

  it('reports a scanned stub on a later line than its disable next-line comment covers', (t) => {
    const { reporter, findings, projectDir } = setup(t);
    writeStory(
      projectDir,
      'Meta.stories.tsx',
      [
        "import { fn } from 'storybook/test';",
        '',
        '// Stryker disable next-line LzStorybookSpyStub',
        'export default {',
        "  args: { onClick: fn().mockReturnValue('stubbed') },",
        '};',
        '',
        'export const Primary = {};',
        '',
      ].join('\n'),
    );

    reporter.onMutationTestReportReady({ files: {} });

    assert.deepEqual(
      findings().map((finding) => isRecord(finding) && finding['line']),
      [5],
    );
  });

  it('scans a *.story.* file when Storybook has no main file', (t) => {
    const { reporter, findings, projectDir } = setup(t);
    writeStory(projectDir, 'Meta.story.tsx', erasedStub);

    reporter.onMutationTestReportReady({ files: {} });

    assert.deepEqual(
      findings().map((finding) => isRecord(finding) && finding['file']),
      ['src/Meta.story.tsx'],
    );
  });

  it('skips story files under node_modules when Storybook has no main file', (t) => {
    const { reporter, findings, projectDir } = setup(t);
    writeStory(
      join(projectDir, 'node_modules', 'ui'),
      'Meta.stories.tsx',
      erasedStub,
    );

    reporter.onMutationTestReportReady({ files: {} });

    assert.deepEqual(findings(), []);
  });

  it('skips a story file that is not JavaScript or TypeScript', (t) => {
    const { reporter, findings, projectDir } = setup(t);
    writeStory(
      projectDir,
      'Docs.stories.mdx',
      '# Docs\n\n<Meta title="Docs" />\n',
    );

    reporter.onMutationTestReportReady({ files: {} });

    assert.deepEqual(findings(), []);
  });

  it('reports the other story files when one cannot be parsed', (t) => {
    const { reporter, findings, projectDir } = setup(t);
    writeStory(projectDir, 'Broken.stories.tsx', 'export const = ;\n');
    writeStory(projectDir, 'Meta.stories.tsx', erasedStub);

    reporter.onMutationTestReportReady({ files: {} });

    assert.deepEqual(
      findings().map((finding) => isRecord(finding) && finding['file']),
      ['src/Meta.stories.tsx'],
    );
  });

  it('warns once, naming a story file it cannot parse', (t) => {
    const { reporter, lines, projectDir } = setup(t);
    writeStory(projectDir, 'Broken.stories.tsx', 'export const = ;\n');

    reporter.onMutationTestReportReady({ files: {} });

    assert.deepEqual(
      lines.filter((line) => line.startsWith('warn: ')),
      [
        'warn: @layzee/stryker-storybook: Babel could not parse src/Broken.stories.tsx, so lz-storybook skipped its spy stubs: Unexpected token (1:13)',
      ],
    );
  });

  it('scans no story file when the spy stub mutator is in excludedMutations', (t) => {
    const { reporter, findings, projectDir } = setup(t, 'no-main', {
      mutator: { excludedMutations: ['LzStorybookSpyStub'] },
    });
    writeStory(projectDir, 'Meta.stories.tsx', erasedStub);

    reporter.onMutationTestReportReady({ files: {} });

    assert.deepEqual(findings(), []);
  });

  it('reports a scanned stub under a disable comment naming another mutator', (t) => {
    const { reporter, findings, projectDir } = setup(t);
    writeStory(
      projectDir,
      'Meta.stories.tsx',
      commentedStub('// Stryker disable next-line StringLiteral'),
    );

    reporter.onMutationTestReportReady({ files: {} });

    assert.deepEqual(
      findings().map((finding) => isRecord(finding) && finding['verdict']),
      ['erased'],
    );
  });

  it('removes the transformer record file when the run ends', (t) => {
    const { reporter, projectDir } = setup(t);
    appendRecord(join(projectDir, 'src', 'Stub.stories.tsx'), 1);

    reporter.wrapUp();

    assert.equal(existsSync(process.env[recordVariable] ?? ''), false);
  });

  it('ends the run without error when the transformer wrote no record file', (t) => {
    const { reporter } = setup(t);

    assert.doesNotThrow(() => reporter.wrapUp());
  });

  it('stays quiet when neither Storybook nor the records show the transformer', (t) => {
    const { reporter, lines } = setup(t);

    reporter.onDryRunCompleted();

    assert.deepEqual(
      lines.filter((line) => line.startsWith('warn: ')),
      [],
    );
  });

  it('writes its report into a reports folder that an earlier run left', (t) => {
    const { reporter, written, projectDir } = setup(t);
    mkdirSync(join(projectDir, 'reports'));

    reporter.onMutationTestReportReady({ files: {} });

    assert.deepEqual(written(), { findings: [], staticStoryMutants: [] });
  });

  it('reports no finding for a Survived mutant of another mutator in a story file', (t) => {
    const { reporter, findings } = setup(t);
    const source = 'export const Primary = { args: { label: 42 } };\n';

    reporter.onMutationTestReportReady({
      files: {
        'src/Meta.stories.tsx': {
          source,
          mutants: [
            {
              mutatorName: 'ObjectLiteral',
              status: 'Survived',
              location: {
                start: { line: 1, column: 30 },
                end: { line: 1, column: 43 },
              },
            },
          ],
        },
      },
    });

    assert.deepEqual(findings(), []);
  });
});
