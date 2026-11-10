import { globSync, readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';

import { isRecord } from './is-record.ts';
import { parseProgram } from './parse.ts';
import type { StorybookProject } from './storybook-project.ts';
import { siteVerdicts } from './stub-ignorer.ts';
import {
  describeVerdict,
  spyStubName,
  type SpyStubReason,
} from './stub-verdict.ts';

export interface ScannedStub extends SpyStubReason {
  readonly fileName: string;
  readonly line: number;
}

interface DirectiveRule {
  readonly disable: boolean;
  readonly line: number | undefined;
  readonly names: readonly string[];
}

interface Site {
  readonly line: number;
  readonly silenced: boolean;
}

// Stryker 10.1.1 instrumenter, src/transformers/directive-bookkeeper.ts
const directive =
  /^\s?Stryker (disable|restore)(?: (next-line))? ([a-zA-Z, ]+)(?::(.+)?)?/;

const commentKeys = new Set([
  'leadingComments',
  'trailingComments',
  'innerComments',
]);

export function selfScan(
  project: StorybookProject,
  isReported: (fileName: string) => boolean,
  onUnparsable: (fileName: string, error: unknown) => void,
): readonly ScannedStub[] {
  return storyFilePaths(project)
    .filter((fileName) => /\.[cm]?[jt]sx?$/.test(fileName))
    .filter((fileName) => !isReported(fileName))
    .flatMap((fileName) => {
      const program = parseStoryFile(
        readFileSync(fileName, 'utf8'),
        fileName,
        onUnparsable,
      );

      if (program === undefined) {
        return [];
      }

      const verdicts = siteVerdicts(program, project);
      const sites = stubSites(program, new Set(verdicts.keys()));

      return [...verdicts].flatMap(([start, verdict]) => {
        const site = sites.get(start);

        return site === undefined || site.silenced
          ? []
          : [{ fileName, line: site.line, ...describeVerdict(verdict) }];
      });
    });
}

function parseStoryFile(
  code: string,
  fileName: string,
  onUnparsable: (fileName: string, error: unknown) => void,
): ReturnType<typeof parseProgram> | undefined {
  try {
    return parseProgram(code, fileName);
  } catch (error) {
    onUnparsable(fileName, error);

    return undefined;
  }
}

function storyFilePaths(project: StorybookProject): readonly string[] {
  return project.storyFiles === 'fallback'
    ? globSync('**/*.{stories,story}.*', {
        exclude: (path) => basename(path) === 'node_modules',
      }).map((file) => resolve(file))
    : [...project.storyFiles];
}

function stubSites(
  program: unknown,
  starts: ReadonlySet<number>,
): ReadonlyMap<number, Site> {
  const sites = new Map<number, Site>();
  const rules: DirectiveRule[] = [];
  const visit = (node: unknown): void => {
    if (!isRecord(node) || typeof node['type'] !== 'string') {
      return;
    }

    const line = startLine(node);
    rules.push(...directiveRules(node['leadingComments'], line));
    const start = node['start'];

    if (
      node['type'] === 'CallExpression' &&
      typeof start === 'number' &&
      starts.has(start) &&
      !sites.has(start)
    ) {
      sites.set(start, { line, silenced: isSilenced(rules, line) });
    }

    Object.entries(node).forEach(([key, value]) => {
      if (!commentKeys.has(key)) {
        (Array.isArray(value) ? value : [value]).forEach(visit);
      }
    });
  };

  visit(program);

  return sites;
}

function directiveRules(
  comments: unknown,
  line: number,
): readonly DirectiveRule[] {
  return (Array.isArray(comments) ? comments : []).flatMap(
    (comment: unknown) => {
      const value = isRecord(comment) ? comment['value'] : undefined;
      const match =
        typeof value === 'string' ? directive.exec(value) : undefined;

      return match
        ? [
            {
              disable: match[1] === 'disable',
              line: match[2] === undefined ? undefined : line,
              names: (match[3] ?? '')
                .split(',')
                .map((name) => name.trim().toLowerCase()),
            },
          ]
        : [];
    },
  );
}

function isSilenced(rules: readonly DirectiveRule[], line: number): boolean {
  return (
    rules.findLast(
      (rule) =>
        (rule.line === undefined || rule.line === line) &&
        (rule.names.includes(spyStubName.toLowerCase()) ||
          rule.names.includes('all')),
    )?.disable === true
  );
}

function startLine(node: Readonly<Record<string, unknown>>): number {
  const loc = node['loc'];
  const start = isRecord(loc) ? loc['start'] : undefined;
  const line = isRecord(start) ? start['line'] : undefined;

  return typeof line === 'number' ? line : 0;
}
