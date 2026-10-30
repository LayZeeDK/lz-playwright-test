import { isRecord } from './is-record.ts';
import { isSerialSuite, type TestRunner } from './playwright-internals.ts';
import { LzStrykerCollectingReporter, type ReportedTest } from './reporter.ts';

/** The ids of a describe.serial group's tests, by the id of each test in it. */
export type SerialGroups = ReadonlyMap<string, readonly string[]>;

// Given no names, listTests would also load the default: false projects.
export function projectsThatRun(
  option: string[] | undefined,
  projects: { default: boolean; project: { name: string } }[],
): string[] {
  return option?.length
    ? option
    : projects
        .filter((project) => project.default)
        .map(({ project }) => project.name);
}

export async function listSerialGroups(
  playwright: Pick<TestRunner, 'listTests'>,
  projects: string[],
): Promise<SerialGroups> {
  const reporter = new LzStrykerCollectingReporter();
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

  return serialGroups(reporter.listedTests);
}

export function serialGroups(testCases: Iterable<ReportedTest>): SerialGroups {
  const bySuite = new Map<object, string[]>();
  const byTest = new Map<string, string[]>();

  [...testCases].forEach((test) => {
    const group = outermostSerialSuite(test);

    if (group) {
      const ids = bySuite.get(group) ?? [];
      ids.push(test.id);
      bySuite.set(group, ids);
      byTest.set(test.id, ids);
    }
  });

  return byTest;
}

// The walk goes from the test outwards, so the last serial suite it meets is the outermost.
function outermostSerialSuite(test: ReportedTest): object | undefined {
  let outermost: object | undefined;

  for (
    let suite: unknown = test.parent;
    isRecord(suite);
    suite = suite.parent
  ) {
    if (isSerialSuite(suite)) {
      outermost = suite;
    }
  }

  return outermost;
}

export function withSerialGroups(
  testFilter: string[] | undefined,
  groups: SerialGroups,
): string[] | undefined {
  return (
    testFilter && [
      ...new Set(testFilter.flatMap((id) => groups.get(id) ?? [id])),
    ]
  );
}
