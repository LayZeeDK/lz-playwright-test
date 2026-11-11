import { isRecord } from './is-record.ts';
import { field, list } from './node-field.ts';
import { parseProgram } from './parse.ts';
import type { StorybookProject } from './storybook-project.ts';
import {
  describeVerdict,
  reasonSites,
  spyStubName,
  type ReasonSite,
  type SpyStubReason,
} from './stub-verdict.ts';

export interface SiteFinding extends SpyStubReason {
  readonly line: number;
}

interface DirectiveRule {
  readonly disable: boolean;
  readonly line: number | undefined;
  readonly names: readonly string[];
}

// Stryker 10.1.1 instrumenter, src/transformers/directive-bookkeeper.ts, without the reason group
const directive =
  /^\s?Stryker (disable|restore)(?: (next-line))? ([a-zA-Z, ]+)/;

export function siteFindings(
  code: string,
  fileName: string,
  project: StorybookProject,
  onUnparsable: (fileName: string, error: unknown) => void,
): readonly SiteFinding[] {
  let program: ReturnType<typeof parseProgram>;

  try {
    program = parseProgram(code, fileName);
  } catch (error) {
    onUnparsable(fileName, error);

    return [];
  }

  const sites = reasonSites({ program, code, fileName }, project);
  const silenced = silencedSites(program, sites);

  return sites
    .filter((site) => !silenced.has(site))
    .map(({ line, verdict }) => ({ line, ...describeVerdict(verdict) }));
}

function silencedSites(
  program: unknown,
  sites: readonly ReasonSite[],
): ReadonlySet<ReasonSite> {
  const silenced = new Set<ReasonSite>();
  const rules: DirectiveRule[] = [];
  const visit = (node: unknown): void => {
    if (!isRecord(node)) {
      return;
    }

    rules.push(...directiveRules(node['leadingComments'], startLine(node)));
    const site = sites.find(({ start }) => node['start'] === start);

    if (site !== undefined && isSilenced(rules, site.line)) {
      silenced.add(site);
    }

    Object.values(node).forEach((value) => {
      (Array.isArray(value) ? value : [value]).forEach(visit);
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
            // Stryker disable next-line StringLiteral: group 3 takes part in every match, so the fallback never runs
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
