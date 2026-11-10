import { readFileSync } from 'node:fs';

import { isRecord } from './is-record.ts';
import { parseProgram } from './parse.ts';
import { storyFilePaths, type StorybookProject } from './storybook-project.ts';
import {
  describeVerdict,
  reasonSites,
  spyStubName,
  type ReasonSite,
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

      const sites = reasonSites(program, project);
      const silenced = silencedSites(program, sites);

      return sites
        .filter((site) => !silenced.has(site))
        .map(({ line, verdict }) => ({
          fileName,
          line,
          ...describeVerdict(verdict),
        }));
    });
}

export function parseStoryFile(
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

export function silencedSites<
  TSite extends Pick<ReasonSite, 'start' | 'end' | 'line'>,
>(program: unknown, sites: readonly TSite[]): ReadonlySet<TSite> {
  const silenced = new Set<TSite>();
  const rules: DirectiveRule[] = [];
  const visit = (node: unknown): void => {
    if (!isRecord(node) || typeof node['type'] !== 'string') {
      return;
    }

    rules.push(...directiveRules(node['leadingComments'], startLine(node)));
    const site = sites.find(
      ({ start, end }) => node['start'] === start && node['end'] === end,
    );

    if (site !== undefined && isSilenced(rules, site.line)) {
      silenced.add(site);
    }

    Object.entries(node).forEach(([key, value]) => {
      if (!commentKeys.has(key)) {
        (Array.isArray(value) ? value : [value]).forEach(visit);
      }
    });
  };

  visit(program);

  return silenced;
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
