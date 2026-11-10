import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';

import {
  PlanKind,
  type MutantEarlyResultPlan,
  type MutantRunPlan,
  type MutantTestCoverage,
  type schema,
} from '@stryker-mutator/api/core';
import type { Reporter } from '@stryker-mutator/api/report';

import { isRecord } from './is-record.ts';
import { lzStorybookOptions } from './options.ts';
import { packageName } from './package-name.ts';
import { parseStoryFile, selfScan, silencedSites } from './self-scan.ts';
import {
  isStoryFile,
  storybookProject,
  type ProjectLog,
  type StorybookProject,
} from './storybook-project.ts';
import { hasRecords, recordVariable } from './stryker-record.ts';
import { definitionTimeStubs } from './stub-shape.ts';
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

type ReportMutant = Pick<
  schema.MutantResult,
  'mutatorName' | 'status' | 'statusReason' | 'location'
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
    storybookProject(lzStorybookOptions(options).configDir, log);

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
        : [
            ...reportFindings(files, warnUnparsable),
            ...selfScan(
              storybook(),
              (fileName) => projectPath(fileName) in files,
              warnUnparsable,
            ).map(({ fileName, ...finding }) => ({
              file: projectPath(fileName),
              ...finding,
            })),
          ];
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

function reportFindings(
  files: ReportInput['files'],
  onUnparsable: (fileName: string, error: unknown) => void,
): readonly StubFinding[] {
  return Object.entries(files).flatMap(([file, { source, mutants }]) => {
    const stubbed = mutants.flatMap(({ statusReason, location }) => {
      const reason =
        statusReason === undefined
          ? undefined
          : parseSpyStubReason(statusReason);

      return reason === undefined
        ? []
        : [{ offset: offsetOf(source, location.start), reason }];
    });
    const program =
      stubbed.length === 0
        ? undefined
        : parseStoryFile(source, file, onUnparsable);
    const sites = program === undefined ? [] : definitionTimeStubs(program);
    const silenced = silencedSites(program, sites);

    return [
      ...sites.flatMap((site) => {
        const found = stubbed.find(
          ({ offset }) => site.start <= offset && offset < site.end,
        );

        return found === undefined || silenced.has(site)
          ? []
          : [{ file, line: site.line, ...found.reason }];
      }),
      ...mutants.flatMap(({ mutatorName, status, location }) =>
        mutatorName === spyStubName && status === 'Survived'
          ? [{ file, line: location.start.line, ...unchecked }]
          : [],
      ),
    ];
  });
}

// Babel's line terminators; report columns are 1-based
function offsetOf(source: string, { line, column }: schema.Position): number {
  const previousBreak = [...source.matchAll(/\r\n?|[\n\p{Zl}\p{Zp}]/gu)]
    .slice(0, line - 1)
    .at(-1);
  const lineStart =
    previousBreak === undefined
      ? 0
      : previousBreak.index + previousBreak[0].length;

  return lineStart + column - 1;
}

function excludesSpyStub(options: object): boolean {
  const mutator: unknown = Reflect.get(options, 'mutator');
  const excluded = isRecord(mutator) ? mutator['excludedMutations'] : undefined;

  return Array.isArray(excluded) && excluded.includes(spyStubName);
}

function projectPath(fileName: string): string {
  return relative(process.cwd(), fileName).split(sep).join('/');
}
