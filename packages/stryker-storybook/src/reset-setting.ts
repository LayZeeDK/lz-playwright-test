import { isRecord } from './is-record.ts';
import { definitionTimeStubs } from './stub-shape.ts';

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

export type ResetSetting = boolean | 'unreadable';

export type ResetSettings =
  | 'unreadable'
  | Readonly<Partial<Record<ResetKey, ResetSetting>>>;

type ResetKey = (typeof decisiveSettings)[number][0];

export function readPreviewTest(program: unknown): ResetSettings {
  const body = list(field(program, 'body'));
  const bindings = topLevelBindings(body);
  const exported = defaultExport(body, bindings);

  if (exported !== undefined) {
    return testSettings(member(exported, 'parameters'));
  }

  const parameters = namedExports(body).find(
    (declarator) => field(declarator, 'id', 'name') === 'parameters',
  );

  return testSettings(
    parameters === undefined
      ? undefined
      : evaluate(field(parameters, 'init'), bindings),
  );
}

function testSettings(parameters: unknown): ResetSettings {
  const test = member(parameters, 'test');

  if (test === unknownValue) {
    return 'unreadable';
  }

  return Object.fromEntries(
    decisiveSettings.flatMap(([key]) => {
      const value = member(test, key);

      if (value === undefined) {
        return [];
      }

      return [[key, typeof value === 'boolean' ? value : 'unreadable']];
    }),
  );
}

function namedExports(body: readonly unknown[]): readonly unknown[] {
  return body.flatMap((statement) =>
    field(statement, 'type') === 'ExportNamedDeclaration'
      ? list(field(statement, 'declaration', 'declarations'))
      : [],
  );
}

export function classifyStubs(
  program: unknown,
  previewTest: ResetSettings,
): StubClassification {
  const body = list(field(program, 'body'));
  const bindings = topLevelBindings(body);
  const factoryMeta = [...bindings.values()].find(
    (init) => field(unwrap(init), 'callee', 'property', 'name') === 'meta',
  );
  const metaTest = testSettings(
    member(
      defaultExport(body, bindings) ??
        evaluate(annotations(factoryMeta), bindings),
      'parameters',
    ),
  );
  const declared = namedExports(body).flatMap((declarator) => {
    const name = field(declarator, 'id', 'name');
    const init = field(declarator, 'init');
    const storyTest = testSettings(
      member(evaluate(annotations(init), bindings), 'parameters'),
    );

    return typeof name === 'string'
      ? [
          {
            story: {
              name,
              branch: branchOf([previewTest, metaTest, storyTest]),
            },
            init,
          },
        ]
      : [];
  });
  const stories = declared.map(({ story }) => story);
  const stubs = definitionTimeStubs(program).map(({ start }) => {
    const owner = declared.findIndex(({ init }) => contains(init, start));
    const users = owner === -1 ? stories.map((_, index) => index) : [owner];

    return { start, verdict: siteVerdict(stories, users) };
  });

  return { stories, stubs };
}

function siteVerdict(
  stories: readonly StoryReset[],
  users: readonly number[],
): StubVerdict {
  const erasesBy = (index: number): boolean =>
    stories.slice(0, index + 1).some(({ branch }) => erases(branch));

  if (!erasesBy(stories.length - 1)) {
    return stories.some(({ branch }) => branch === 'unknown')
      ? 'unknown'
      : 'kept';
  }

  return users.every(erasesBy) ? 'erased' : 'order-dependent';
}

function erases(branch: ResetBranch): boolean {
  return branch === 'reset' || branch === 'restore';
}

function contains(node: unknown, position: number): boolean {
  const start = field(node, 'start');
  const end = field(node, 'end');

  return (
    typeof start === 'number' &&
    typeof end === 'number' &&
    start <= position &&
    position < end
  );
}

const decisiveSettings = [
  ['mockReset', true, 'reset'],
  ['clearMocks', true, 'clear'],
  ['restoreMocks', false, 'none'],
] as const;

function branchOf(levels: readonly ResetSettings[]): ResetBranch {
  return (
    decisiveSettings
      .map(([key, decisive, branch]) => {
        const setting = levels.reduce<ResetSetting | undefined>(
          (value, level) =>
            level === 'unreadable' ? level : (level[key] ?? value),
          undefined,
        );

        if (setting === 'unreadable') {
          return 'unknown';
        }

        return setting === decisive ? branch : undefined;
      })
      .find((branch) => branch !== undefined) ?? 'restore'
  );
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

function defaultExport(
  body: readonly unknown[],
  bindings: ReadonlyMap<string, unknown>,
): unknown {
  const declaration = unwrap(
    field(
      body.find(
        (statement) => field(statement, 'type') === 'ExportDefaultDeclaration',
      ),
      'declaration',
    ),
  );

  if (declaration === undefined) {
    return undefined;
  }

  return evaluate(annotations(declaration), bindings);
}

const annotationFactories: readonly unknown[] = [
  'definePreview',
  'meta',
  'story',
];

function annotations(node: unknown): unknown {
  const current = unwrap(node);

  return field(current, 'type') === 'CallExpression' &&
    annotationFactories.includes(
      field(current, 'callee', 'name') ??
        field(current, 'callee', 'property', 'name'),
    )
    ? field(current, 'arguments', '0')
    : current;
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

function evaluate(
  node: unknown,
  bindings: ReadonlyMap<string, unknown>,
): unknown {
  const current = unwrap(node);

  switch (field(current, 'type')) {
    case 'BooleanLiteral': {
      return field(current, 'value');
    }
    case 'Identifier': {
      const name = field(current, 'name');

      if (name === 'undefined') {
        return undefined;
      }

      return typeof name === 'string' && bindings.has(name)
        ? evaluate(bindings.get(name), bindings)
        : unknownValue;
    }
    case 'ObjectExpression': {
      return Object.fromEntries(
        list(field(current, 'properties')).map((property) => [
          String(field(property, 'key', 'name')),
          evaluate(field(property, 'value'), bindings),
        ]),
      );
    }
    default: {
      return unknownValue;
    }
  }
}

const unknownValue = Symbol('unknown');

function member(value: unknown, key: string): unknown {
  if (value === unknownValue) {
    return unknownValue;
  }

  return isRecord(value) ? value[key] : undefined;
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
