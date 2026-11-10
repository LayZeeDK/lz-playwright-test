import { isRecord } from './is-record.ts';

export type ResetBranch = 'reset' | 'clear' | 'restore' | 'none' | 'unknown';

export type StubVerdict = 'kept' | 'erased' | 'order-dependent' | 'unknown';

export interface StoryReset {
  readonly name: string;
  readonly branch: ResetBranch;
}

export interface ClassifiedStub {
  readonly start: number;
  readonly verdict: StubVerdict;
}

export interface StubClassification {
  readonly stories: readonly StoryReset[];
  readonly stubs: readonly ClassifiedStub[];
}

export function readPreviewTest(program: unknown): unknown {
  return field(
    defaultExport(list(field(program, 'body'))),
    'parameters',
    'test',
  );
}

export function classifyStubs(
  program: unknown,
  previewTest: unknown,
): StubClassification {
  const body = list(field(program, 'body'));
  const metaTest = field(defaultExport(body), 'parameters', 'test');
  const restoreMocks =
    field(metaTest, 'restoreMocks') ?? field(previewTest, 'restoreMocks');
  const branch: ResetBranch = restoreMocks === false ? 'none' : 'restore';
  const stories = body.flatMap((statement) =>
    field(statement, 'type') === 'ExportNamedDeclaration'
      ? list(field(statement, 'declaration', 'declarations')).flatMap(
          (declarator) => {
            const name = field(declarator, 'id', 'name');

            return typeof name === 'string' ? [{ name, branch }] : [];
          },
        )
      : [],
  );

  return { stories, stubs: [] };
}

const wrappers: readonly unknown[] = [
  'TSSatisfiesExpression',
  'TSAsExpression',
  'TSNonNullExpression',
  'TSTypeAssertion',
  'ParenthesizedExpression',
];

function unwrap(node: unknown): unknown {
  return wrappers.includes(field(node, 'type'))
    ? unwrap(field(node, 'expression'))
    : node;
}

function defaultExport(body: readonly unknown[]): unknown {
  const name = field(
    body.find(
      (statement) => field(statement, 'type') === 'ExportDefaultDeclaration',
    ),
    'declaration',
    'name',
  );

  return typeof name === 'string'
    ? evaluate(topLevelBindings(body).get(name))
    : undefined;
}

function topLevelBindings(
  body: readonly unknown[],
): ReadonlyMap<string, unknown> {
  return new Map(
    body.flatMap((statement) => {
      const declaration =
        field(statement, 'type') === 'ExportNamedDeclaration'
          ? field(statement, 'declaration')
          : statement;

      return list(field(declaration, 'declarations')).flatMap((declarator) => {
        const name = field(declarator, 'id', 'name');
        const init = field(declarator, 'init');

        return typeof name === 'string' && init !== null
          ? [[name, init] as const]
          : [];
      });
    }),
  );
}

function evaluate(node: unknown): unknown {
  const current = unwrap(node);

  switch (field(current, 'type')) {
    case 'BooleanLiteral': {
      return field(current, 'value');
    }
    case 'ObjectExpression': {
      return Object.fromEntries(
        list(field(current, 'properties')).map((property) => [
          String(field(property, 'key', 'name')),
          evaluate(field(property, 'value')),
        ]),
      );
    }
    default: {
      return undefined;
    }
  }
}

function field(node: unknown, ...keys: readonly string[]): unknown {
  return keys.reduce<unknown>(
    (value, key) => (isRecord(value) ? value[key] : undefined),
    node,
  );
}

function list(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}
