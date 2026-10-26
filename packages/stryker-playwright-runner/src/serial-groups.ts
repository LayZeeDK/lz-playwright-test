import type { Suite, TestCase } from '@playwright/test/reporter';

import { isSerialSuite, type TestRunner } from './playwright-internals.ts';
import { CollectingReporter } from './reporter.ts';

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
  const reporter = new CollectingReporter();
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

export function serialGroups(testCases: Iterable<TestCase>): SerialGroups {
  const bySuite = new Map<object, string[]>();
  const byTest = new Map<string, string[]>();

  for (const test of testCases) {
    let group: object | undefined;

    for (
      let suite: Suite | undefined = test.parent;
      suite;
      suite = suite.parent
    ) {
      if (isSerialSuite(suite)) {
        group = suite;
      }
    }

    if (group) {
      const ids = bySuite.get(group) ?? [];
      ids.push(test.id);
      bySuite.set(group, ids);
      byTest.set(test.id, ids);
    }
  }

  return byTest;
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
