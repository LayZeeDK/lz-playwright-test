import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';

import { PlanKind } from '@stryker-mutator/api/core';
import type { Reporter } from '@stryker-mutator/api/report';

import { lzStorybookOptions } from './options.ts';
import { packageName } from './package-name.ts';
import {
  isStoryFile,
  storybookProject,
  type ProjectLog,
  type StorybookProject,
} from './storybook-project.ts';
import { hasRecords, recordVariable } from './stryker-record.ts';
import {
  parseSpyStubReason,
  spyStubName,
  type ReasonVerdict,
} from './stub-verdict.ts';

const unchecked = {
  verdict: 'unchecked',
  why: 'no test fails without this stub, so no play checks what it changes',
  fix: 'assert in the play what the stubbed value changes',
} as const;

export interface LzStorybookReport {
  readonly findings: readonly StubFinding[];
  readonly staticStoryMutants: readonly StaticStoryMutant[];
}

interface StubFinding {
  readonly file: string;
  readonly line: number;
  readonly verdict: ReasonVerdict | 'unchecked';
  readonly why: string;
  readonly fix: string;
}

interface ReportMutant {
  readonly mutatorName: string;
  readonly status: string;
  readonly statusReason?: string | undefined;
  readonly location: { readonly start: { readonly line: number } };
}

interface ReportInput {
  readonly files: Readonly<
    Record<string, { readonly mutants: readonly ReportMutant[] }>
  >;
}

interface StaticStoryMutant {
  readonly file: string;
  readonly line: number;
  readonly mutatorName: string;
  readonly netTime: number;
}

interface PlanMutant {
  readonly fileName: string;
  readonly mutatorName: string;
  readonly static?: boolean | undefined;
  readonly location: { readonly start: { readonly line: number } };
}

type MutantPlan =
  | {
      readonly plan: PlanKind.Run;
      readonly netTime: number;
      readonly mutant: PlanMutant;
    }
  | { readonly plan: PlanKind.EarlyResult; readonly mutant: PlanMutant };

interface PlanEvent {
  readonly mutantPlans: readonly MutantPlan[];
}

export function storybookReporter(options: object, log: ProjectLog) {
  let staticStoryMutants: readonly StaticStoryMutant[] = [];
  let project: StorybookProject | undefined;
  const recordFile = join(
    tmpdir(),
    `lz-storybook-records-${randomUUID()}.jsonl`,
  );
  process.env[recordVariable] = recordFile;
  const storybook = (): StorybookProject =>
    (project ??= storybookProject(lzStorybookOptions(options).configDir, log));

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
      const findings = Object.entries(files).flatMap(([file, { mutants }]) =>
        mutants.flatMap((mutant) => {
          const verdict = stubVerdict(mutant);

          return verdict === undefined
            ? []
            : [{ file, line: mutant.location.start.line, ...verdict }];
        }),
      );
      const report: LzStorybookReport = { findings, staticStoryMutants };
      mkdirSync('reports', { recursive: true });
      writeFileSync(
        join('reports', 'lz-storybook.json'),
        JSON.stringify(report, null, 2),
      );
      log.info(consoleBlock(report));
    },
  } satisfies Reporter;
}

function consoleBlock({
  findings,
  staticStoryMutants,
}: LzStorybookReport): string {
  if (findings.length === 0 && staticStoryMutants.length === 0) {
    return `${packageName}: no spy stub findings and no static story mutants`;
  }

  const counts = Object.entries(
    Object.groupBy(findings, ({ verdict }) => verdict),
  ).map(([verdict, group]) => `${group?.length ?? 0} ${verdict}`);

  return [
    findings.length === 0
      ? `${packageName}: no spy stub findings`
      : `${packageName}: ${findings.length} spy stub findings (${counts.join(', ')})`,
    ...findings.map(
      ({ verdict, file, line, why, fix }) =>
        `  ${verdict}  ${file}:${line}  ${why}; ${fix}`,
    ),
    ...(staticStoryMutants.length === 0
      ? []
      : [
          `  static story mutants: ${staticStoryMutants.length}, each runs every test; net times in reports/lz-storybook.json`,
        ]),
  ].join('\n');
}

function projectPath(fileName: string): string {
  return relative(process.cwd(), fileName).split(sep).join('/');
}

function stubVerdict({ mutatorName, status, statusReason }: ReportMutant) {
  if (mutatorName === spyStubName && status === 'Survived') {
    return unchecked;
  }

  return statusReason === undefined
    ? undefined
    : parseSpyStubReason(statusReason);
}
