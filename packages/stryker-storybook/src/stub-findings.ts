import { isRecord } from './is-record.ts';
import { field, list } from './node-field.ts';
import { parseProgram } from './parse.ts';
import { spyStubName, type ReasonSite } from './stub-verdict.ts';

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
  return list(comments).flatMap((comment: unknown) => {
    const value = field(comment, 'value');
    const match = typeof value === 'string' ? directive.exec(value) : undefined;

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
  });
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

function startLine(node: unknown): number {
  const line = field(node, 'loc', 'start', 'line');

  return typeof line === 'number' ? line : 0;
}
