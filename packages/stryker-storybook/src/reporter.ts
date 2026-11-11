import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';

import {
  PlanKind,
  type MutantEarlyResultPlan,
  type MutantRunPlan,
  type MutantTestCoverage,
  type schema,
} from '@stryker-mutator/api/core';
import { commonTokens, tokens } from '@stryker-mutator/api/plugin';
import type { Reporter } from '@stryker-mutator/api/report';

import { field, list } from './node-field.ts';
import { packageName } from './package-name.ts';
import {
  isStoryFile,
  storyFilePaths,
  strykerStorybookProject,
  type ProjectLog,
  type StorybookProject,
} from './storybook-project.ts';
import { hasRecords, recordVariable } from './stryker-record.ts';
import { siteFindings } from './stub-findings.ts';
import {
  spyStubName,
  uncheckedFinding,
  type ReasonVerdict,
} from './stub-verdict.ts';

export interface LzStorybookReport {
  readonly findings: readonly StubFinding[];
  readonly staticStoryMutants: readonly StaticStoryMutant[];
}

interface StubFinding {
  readonly file: string;
  readonly line: number;
  readonly verdict: ReasonVerdict | (typeof uncheckedFinding)['verdict'];
  readonly reason: string;
  readonly fix: string;
}

type ReportMutant = Pick<
  schema.MutantResult,
  'mutatorName' | 'status' | 'location'
>;

interface ReportInput {
  readonly files: Readonly<
    Record<
      string,
      Pick<schema.FileResult, 'source'> & {
        readonly mutants: readonly ReportMutant[];
      }
    >
  >;
}

interface StaticStoryMutant {
  readonly file: string;
  readonly line: number;
  readonly mutatorName: string;
  readonly netTime: number;
}

type MutantPlan = (
  | Pick<MutantRunPlan, 'plan' | 'netTime'>
  | Pick<MutantEarlyResultPlan, 'plan'>
) & {
  readonly mutant: Pick<
    MutantTestCoverage,
    'fileName' | 'mutatorName' | 'static' | 'location'
  >;
};

interface PlanEvent {
  readonly mutantPlans: readonly MutantPlan[];
}

export function storybookReporter(options: object, log: ProjectLog) {
  let staticStoryMutants: readonly StaticStoryMutant[] = [];
  const recordFile = join(
    tmpdir(),
    `lz-storybook-records-${randomUUID()}.jsonl`,
  );
  process.env[recordVariable] = recordFile;
  const storybook = (): StorybookProject =>
    strykerStorybookProject(options, log);

  return {
    onDryRunCompleted(): void {
      const rewritten = hasRecords(recordFile);
      const seen = storybook().transformer === 'seen';

      if (rewritten && !seen) {
        log.warn(
          `${packageName}: the mock transformer rewrote stubs during the dry run, but the Storybook main file's viteFinal does not add lzStorybookMockTransformerPlugin(), so the lz-storybook ignorer treated repaired stubs as erased; add the plugin through viteFinal`,
        );
      }

      if (seen && !rewritten) {
        log.warn(
          `${packageName}: the Storybook main file's viteFinal adds lzStorybookMockTransformerPlugin(), but it rewrote no stub during the dry run, so the lz-storybook ignorer may have kept stubs that the mock reset erases; check that the test run uses the Storybook Vite config, or ignore this if no story file stubs a spy outside a function`,
        );
      }
    },
    onMutationTestingPlanReady({ mutantPlans }: PlanEvent): void {
      staticStoryMutants = mutantPlans.flatMap((plan) =>
        plan.plan === PlanKind.Run &&
        plan.mutant.static === true &&
        isStoryFile(storybook(), plan.mutant.fileName)
          ? [
              {
                file: projectPath(plan.mutant.fileName),
                line: plan.mutant.location.start.line + 1,
                mutatorName: plan.mutant.mutatorName,
                netTime: plan.netTime,
              },
            ]
          : [],
      );
    },
    onMutationTestReportReady({ files }: ReportInput): void {
      const warnUnparsable = (fileName: string, error: unknown): void =>
        log.warn(
          `${packageName}: Babel could not parse ${projectPath(fileName)}, so lz-storybook skipped its spy stubs: ${error instanceof Error ? error.message : String(error)}`,
        );
      const findings = excludesSpyStub(options)
        ? []
        : stubFindings(files, storybook(), warnUnparsable);
      const report: LzStorybookReport = { findings, staticStoryMutants };
      mkdirSync('reports', { recursive: true });
      writeFileSync(
        join('reports', 'lz-storybook.json'),
        JSON.stringify(report, null, 2),
      );
      log.info(consoleBlock(report));
    },
    wrapUp(): void {
      rmSync(recordFile, { force: true });
    },
  } satisfies Reporter;
}

storybookReporter.inject = tokens(commonTokens.options, commonTokens.logger);

function consoleBlock({
  findings,
  staticStoryMutants,
}: LzStorybookReport): string {
  if (findings.length === 0 && staticStoryMutants.length === 0) {
    return `${packageName}: no spy stub findings and no static story mutants`;
  }

  const counts = Object.entries(
    Object.groupBy(findings, ({ verdict }) => verdict),
  ).map(([verdict, group]) => `${group.length} ${verdict}`);

  return [
    findings.length === 0
      ? `${packageName}: no spy stub findings`
      : `${packageName}: ${findings.length} spy stub findings (${counts.join(', ')})`,
    ...findings.map(
      ({ verdict, file, line, reason, fix }) =>
        `  ${verdict}  ${file}:${line}  ${reason}; ${fix}`,
    ),
    ...(staticStoryMutants.length === 0
      ? []
      : [
          `  static story mutants: ${staticStoryMutants.length}, each runs every test; net times in reports/lz-storybook.json`,
        ]),
  ].join('\n');
}

function stubFindings(
  files: ReportInput['files'],
  project: StorybookProject,
  onUnparsable: (fileName: string, error: unknown) => void,
): readonly StubFinding[] {
  const storyFiles = new Set([
    ...Object.keys(files).filter((file) => isStoryFile(project, resolve(file))),
    ...storyFilePaths(project)
      .filter((fileName) => /\.[cm]?[jt]sx?$/.test(fileName))
      .map(projectPath),
  ]);

  return [
    ...[...storyFiles].flatMap((file) =>
      siteFindings(
        files[file]?.source ?? readFileSync(file, 'utf8'),
        file,
        project,
        onUnparsable,
      ).map((finding) => ({ file, ...finding })),
    ),
    ...Object.entries(files).flatMap(([file, { mutants }]) =>
      mutants.flatMap(({ mutatorName, status, location }) =>
        mutatorName === spyStubName && status === 'Survived'
          ? [{ file, line: location.start.line, ...uncheckedFinding }]
          : [],
      ),
    ),
  ];
}

function excludesSpyStub(options: object): boolean {
  return list(field(options, 'mutator', 'excludedMutations')).includes(
    spyStubName,
  );
}

function projectPath(fileName: string): string {
  return relative(process.cwd(), fileName).split(sep).join('/');
}
