import type { Ignorer } from '@stryker-mutator/api/ignore';
import { commonTokens, tokens } from '@stryker-mutator/api/plugin';

import { csfShapes, type CsfShapes } from './csf.ts';
import { isRecord } from './is-record.ts';
import { field, list } from './node-field.ts';
import {
  isStoryFile,
  strykerStorybookProject,
  type ProjectLog,
} from './storybook-project.ts';

export const csfIgnorerName = 'lz-storybook-csf';

const staticReason = `${csfIgnorerName}: Storybook reads this CSF value without running the file, so it stays as written`;
const metaReason = `${csfIgnorerName}: Storybook reads the meta object without running the file, so it stays an object literal`;
const containerReason = `${csfIgnorerName}: Storybook reads this story, its parameters or its test options without running the file, so it stays an object or a function`;
const testReason = `${csfIgnorerName}: test code in a story file is mutated by the Stryker config with lzStorybookCsf.play set to mutate`;
const mswReason = `${csfIgnorerName}: msw handlers in a story file are mutated by the Stryker config with lzStorybookCsf.play set to mutate`;

export function csfIgnorer(options: object, log: ProjectLog): Ignorer {
  const ignoreMode = field(options, 'lzStorybookCsf', 'play') !== 'mutate';
  let reasons: ReadonlyMap<unknown, string> = new Map();
  const fileReasons = (
    program: unknown,
    fileName: unknown,
  ): ReadonlyMap<unknown, string> => {
    if (
      typeof fileName !== 'string' ||
      !isStoryFile(strykerStorybookProject(options, log), fileName)
    ) {
      return new Map();
    }

    if (!ignoreMode) {
      return staticReasons(csfShapes(program));
    }

    const shapes = csfShapes(program);
    // StrykerJS reads a node's leading comments when it enters that node, after the ignorer has seen the Program node.
    shapes.literalContainers.forEach(keepLiteralContainer);

    return ignoreModeReasons(shapes);
  };

  return {
    shouldIgnore(path) {
      const node = field(path, 'node');

      if (field(node, 'type') === 'Program') {
        reasons = fileReasons(
          node,
          field(path, 'hub', 'file', 'opts', 'filename'),
        );
      }

      return reasons.get(node);
    },
  };
}

csfIgnorer.inject = tokens(commonTokens.options, commonTokens.logger);

function staticReasons(shapes: CsfShapes): ReadonlyMap<unknown, string> {
  return new Map(
    [...shapes.staticValues].map((node) => [node, staticReason] as const),
  );
}

function ignoreModeReasons(shapes: CsfShapes): ReadonlyMap<unknown, string> {
  // A later entry wins: meta over test code over msw over static values.
  return new Map([
    ...staticReasons(shapes),
    ...[...shapes.mswValues].map((node) => [node, mswReason] as const),
    ...[...shapes.testCode].map((node) => [node, testReason] as const),
    ...[...shapes.metaObjects].map((node) => [node, metaReason] as const),
  ]);
}

// A Stryker ignorer skips a whole subtree; a next-line directive skips only the mutants on the container's first line.
function keepLiteralContainer(container: unknown): void {
  if (!isRecord(container)) {
    return;
  }

  container['leadingComments'] = [
    ...list(container['leadingComments']),
    {
      // Stryker disable next-line StringLiteral: Babel prints a comment of any type but CommentBlock as a line comment, and StrykerJS reads only its value
      type: 'CommentLine',
      value: ` Stryker disable next-line ObjectLiteral,ArrowFunction: ${containerReason}`,
    },
  ];
}
