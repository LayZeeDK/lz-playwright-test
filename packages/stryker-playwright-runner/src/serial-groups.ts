import { isRecord } from './is-record.ts';
import type { TestRunner } from './playwright-internals.ts';
import {
  LzPlaywrightCollectingReporter,
  type ReportedTest,
} from './reporter.ts';

/** The ids of a describe.serial group's tests, by the id of each test in it. */
export type SerialGroups = ReadonlyMap<string, readonly string[]>;

type IsSerialSuite = (suite: unknown) => boolean;

// Given no names, listTests would also load the default: false projects.
export function projectsThatRun(
  option: readonly string[] | undefined,
  projects: readonly { default: boolean; project: { name: string } }[],
): readonly string[] {
  return option?.length
    ? option
    : projects
        .filter((project) => project.default)
        .map(({ project }) => project.name);
}

export async function listSerialGroups(
  playwright: Pick<TestRunner, 'listTests'>,
  projects: readonly string[],
  isSerial: IsSerialSuite,
): Promise<SerialGroups> {
  const reporter = new LzPlaywrightCollectingReporter();
  const result = await playwright.listTests(reporter, { projects });

  if (!result) {
    throw new Error(
      'Playwright threw while listing the tests. Rerun Stryker with --logLevel trace to see its error.',
    );
  }

  if (result.status !== 'passed') {
    throw new Error(
      `Playwright could not list the tests (${result.status}):\n${reporter.errors.join('\n')}`,
    );
  }

  // A file that fails to load leaves the status "passed", and its serial groups would be missing.
  if (reporter.errors.length) {
    throw new Error(
      `Playwright could not load every test file:\n${reporter.errors.join('\n')}`,
    );
  }

  return serialGroups(reporter.listedTests, isSerial);
}

export function serialGroups(
  testCases: Iterable<ReportedTest>,
  isSerial: IsSerialSuite,
): SerialGroups {
  const bySuite = new Map<object, string[]>();
  const byTest = new Map<string, string[]>();

  [...testCases].forEach((test) => {
    const group = outermostSerialSuite(test, isSerial);

    if (group) {
      const ids = bySuite.get(group) ?? [];
      ids.push(test.id);
      bySuite.set(group, ids);
      byTest.set(test.id, ids);
    }
  });

  return byTest;
}

function outermostSerialSuite(
  test: ReportedTest,
  isSerial: IsSerialSuite,
): object | undefined {
  let outermost: object | undefined;

  for (
    let suite: unknown = test.parent;
    isRecord(suite);
    suite = suite['parent']
  ) {
    if (isSerial(suite)) {
      outermost = suite;
    }
  }

  return outermost;
}

export function withSerialGroups(
  testIds: readonly string[],
  groups: SerialGroups,
): string[] {
  return [...new Set(testIds.flatMap((id) => groups.get(id) ?? [id]))];
}
