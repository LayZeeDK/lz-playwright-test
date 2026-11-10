import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { describe, it, type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';

import { PlanKind } from '@stryker-mutator/api/core';

import { isRecord } from '../src/is-record.ts';
import { storybookReporter } from '../src/reporter.ts';
import { appendRecord, recordVariable } from '../src/stryker-record.ts';
import { parseSpyStubReason, spyStubReason } from '../src/stub-verdict.ts';
import recorded from './fixtures/reporter/mutation.json' with { type: 'json' };

const fixtures = fileURLToPath(new URL('fixtures/', import.meta.url));

function runPlan(fileName: string, line: number, isStatic = true) {
  return {
    plan: PlanKind.Run,
    netTime: 362,
    mutant: {
      fileName,
      mutatorName: 'LzStorybookSpyStub',
      static: isStatic,
      location: { start: { line } },
    },
  } as const;
}

function setup(t: TestContext, fixture = 'no-main') {
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
    { lzStorybook: { configDir: join(fixtures, fixture, '.storybook') } },
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
    projectDir,
    written,
    findings: (): readonly unknown[] => {
      const report = written();

      return isRecord(report) && Array.isArray(report['findings'])
        ? report['findings']
        : [];
    },
  };
}

describe('storybookReporter', () => {
  it('writes an empty report when the run has no story findings', (t) => {
    const { reporter, written } = setup(t);

    reporter.onMutationTestReportReady({ files: {} });

    assert.deepEqual(written(), { findings: [], staticStoryMutants: [] });
  });

  it('reports an Ignored mutant with the erased reason as an erased stub', (t) => {
    const { reporter, findings } = setup(t);

    reporter.onMutationTestReportReady(recorded);

    assert.deepEqual(
      findings().filter(
        (finding) => isRecord(finding) && finding['verdict'] === 'erased',
      ),
      [
        {
          file: 'src/SpyStubDefault.stories.tsx',
          line: 15,
          ...parseSpyStubReason(spyStubReason('erased')),
        },
      ],
    );
  });

  it('reports the order-dependent and unknown reasons with their files and lines', (t) => {
    const { reporter, findings } = setup(t);

    reporter.onMutationTestReportReady(recorded);

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
          ...parseSpyStubReason(spyStubReason('unknown')),
        },
        {
          file: 'src/lzsb/OrderDep.stories.tsx',
          line: 13,
          ...parseSpyStubReason(spyStubReason('order-dependent')),
        },
      ],
    );
  });

  it('reports a Survived spy stub mutant as an unchecked stub', (t) => {
    const { reporter, findings } = setup(t);

    reporter.onMutationTestReportReady(recorded);

    assert.deepEqual(
      findings().filter(
        (finding) => isRecord(finding) && finding['verdict'] === 'unchecked',
      ),
      [
        {
          file: 'src/SpyStubMetaOff.stories.tsx',
          line: 24,
          verdict: 'unchecked',
          why: 'no test fails without this stub, so no play checks what it changes',
          fix: 'assert in the play what the stubbed value changes',
        },
      ],
    );
  });

  it('reports no finding for a Killed spy stub or a mutant ignored for another reason', (t) => {
    const { reporter, findings } = setup(t);

    reporter.onMutationTestReportReady(recorded);

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
    const { reporter, lines } = setup(t);

    reporter.onMutationTestReportReady(recorded);

    assert.equal(
      lines.join('\n').split('\n')[0],
      'info: @layzee/stryker-storybook: 4 spy stub findings (1 unknown, 1 order-dependent, 1 erased, 1 unchecked)',
    );
  });

  it('prints one line per finding with its verdict, place, cause and fix', (t) => {
    const { reporter, lines } = setup(t);
    const erased = parseSpyStubReason(spyStubReason('erased'));

    reporter.onMutationTestReportReady(recorded);

    assert.equal(
      lines.join('\n').split('\n')[3],
      `  erased  src/SpyStubDefault.stories.tsx:15  ${erased?.why}; ${erased?.fix}`,
    );
  });

  it('closes its console block with the static story mutant count', (t) => {
    const { reporter, lines, projectDir } = setup(t);

    reporter.onMutationTestingPlanReady({
      mutantPlans: [
        runPlan(join(projectDir, 'src', 'SpyStubMetaOff.stories.tsx'), 16),
        runPlan(join(projectDir, 'src', 'SpyStubMetaOff.stories.tsx'), 23),
      ],
    });
    reporter.onMutationTestReportReady(recorded);

    assert.equal(
      lines.join('\n').split('\n').at(-1),
      '  static story mutants: 2, each runs every test; net times in reports/lz-storybook.json',
    );
  });

  it('prints one line saying so when the run has no story findings', (t) => {
    const { reporter, lines } = setup(t);

    reporter.onMutationTestReportReady({ files: {} });

    assert.deepEqual(lines, [
      'info: @layzee/stryker-storybook: no spy stub findings and no static story mutants',
    ]);
  });

  it('leaves the static line out when the run has no static story mutant', (t) => {
    const { reporter, lines } = setup(t);

    reporter.onMutationTestReportReady(recorded);

    assert.equal(lines.join('\n').split('\n').length, 5);
  });

  it('says there are no findings above the static line when only static mutants exist', (t) => {
    const { reporter, lines, projectDir } = setup(t);

    reporter.onMutationTestingPlanReady({
      mutantPlans: [
        runPlan(join(projectDir, 'src', 'SpyStubMetaOff.stories.tsx'), 16),
      ],
    });
    reporter.onMutationTestReportReady({ files: {} });

    assert.equal(
      lines.at(-1)?.split('\n')[0],
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

  it('stays quiet when neither Storybook nor the records show the transformer', (t) => {
    const { reporter, lines } = setup(t);

    reporter.onDryRunCompleted();

    assert.deepEqual(
      lines.filter((line) => line.startsWith('warn: ')),
      [],
    );
  });
});
