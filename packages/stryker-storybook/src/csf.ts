import { field, list } from './node-field.ts';

export interface CsfShapes {
  readonly metaObjects: ReadonlySet<unknown>;
  /** Story objects and functions, `parameters` objects that hold `__id`, and `.test()` options objects. */
  readonly literalContainers: ReadonlySet<unknown>;
  readonly testCode: ReadonlySet<unknown>;
  readonly mswValues: ReadonlySet<unknown>;
  readonly staticValues: ReadonlySet<unknown>;
}

type Bindings = ReadonlyMap<string, unknown>;

const testKeys = ['play', 'beforeEach', 'afterEach'];
const staticKeys = [
  'title',
  'id',
  'tags',
  'includeStories',
  'excludeStories',
  'name',
  'storyName',
];

export function csfShapes(program: unknown): CsfShapes {
  const body = list(field(program, 'body'));
  const bindings = topLevelBindings(body);
  const declaration = field(
    body.find(
      (statement) => field(statement, 'type') === 'ExportDefaultDeclaration',
    ),
    'declaration',
  );
  const specifiers = body.flatMap((statement) =>
    list(field(statement, 'specifiers')),
  );
  const defaultSpecifier = specifiers.find(
    (specifier) => field(specifier, 'exported', 'name') === 'default',
  );
  const metaObjects = [
    ...objectOf(declaration ?? field(defaultSpecifier, 'local'), bindings),
    ...[...bindings.values()]
      .filter((init) => field(init, 'callee', 'property', 'name') === 'meta')
      .map((init) => list(field(init, 'arguments'))[0]),
  ];

  const [includeStories, excludeStories] = [
    'includeStories',
    'excludeStories',
  ].map((key) =>
    metaObjects
      .map((meta) => propertyValue(meta, key))
      .find((value) => value !== undefined),
  );
  const storyExports = [
    ...namedExports(program),
    ...body.flatMap((statement) =>
      assigned(statement, 'story').map((init) => ({
        name: field(statement, 'expression', 'left', 'object', 'name'),
        init,
      })),
    ),
  ].filter(({ name }) => isExportStory(name, includeStories, excludeStories));
  const storyNames = storyExports.map(({ name }) => name);
  const stories = storyExports
    .map(({ init }) => storyNode(unwrap(init), bindings))
    .filter(
      (init) =>
        (field(init, 'type') === 'ObjectExpression' ||
          field(init, 'type') === 'ArrowFunctionExpression') &&
        !metaObjects.includes(init),
    );
  const storyAnnotations = (key: string): readonly unknown[] => [
    ...stories.map((story) => propertyValue(story, key)),
    ...body.flatMap((statement) =>
      storyNames.includes(
        field(statement, 'expression', 'left', 'object', 'name'),
      )
        ? assigned(statement, key)
        : [],
    ),
  ];
  const annotations = (key: string): readonly unknown[] =>
    [
      ...metaObjects.map((meta) => propertyValue(meta, key)),
      ...storyAnnotations(key),
    ].flatMap((value) => withInit(value, bindings));
  const idParameters = stories
    .map((story) => propertyValue(story, 'parameters'))
    .filter((parameters) => propertyValue(parameters, '__id') !== undefined);
  const testCalls = body.flatMap((statement) => {
    const [name, ...rest] = testArguments(statement);

    return name !== undefined &&
      storyNames.includes(
        field(statement, 'expression', 'callee', 'object', 'name'),
      )
      ? [
          {
            statement,
            name,
            options:
              rest.length > 1 ? followed(rest[0], bindings) : undefined,
            testFunction: followed(rest.at(-1), bindings),
          },
        ]
      : [];
  });

  return {
    metaObjects: nodeSet(metaObjects),
    literalContainers: nodeSet([
      ...stories,
      ...idParameters,
      ...testCalls.map(({ options }) => options),
    ]),
    testCode: nodeSet([
      ...testKeys.flatMap(annotations),
      ...testCalls.flatMap(({ statement, testFunction }) => [
        statement,
        testFunction,
      ]),
    ]),
    mswValues: nodeSet(
      storyAnnotations('parameters').map((parameters) =>
        propertyValue(parameters, 'msw'),
      ),
    ),
    staticValues: nodeSet([
      ...staticKeys.flatMap(annotations),
      ...idParameters.map((parameters) => propertyValue(parameters, '__id')),
      bindings.get('__namedExportsOrder'),
      ...testCalls.flatMap(({ name, options }) => [
        name,
        ...withInit(propertyValue(options, 'tags'), bindings),
      ]),
      ...specifiers.map((specifier) => field(specifier, 'exported')),
    ]),
  };
}

function nodeSet(values: readonly unknown[]): ReadonlySet<unknown> {
  return new Set(values.filter((value) => value !== undefined));
}

export interface NamedExport {
  readonly name: string;
  readonly init: unknown;
}

export function namedExports(program: unknown): readonly NamedExport[] {
  const body = list(field(program, 'body'));
  const bindings = topLevelBindings(body);

  return body
    .filter(
      (statement) => field(statement, 'type') === 'ExportNamedDeclaration',
    )
    .flatMap((statement) => [
      ...list(field(statement, 'declaration', 'declarations')).map(
        (declarator) => ({
          name: field(declarator, 'id', 'name'),
          init: field(declarator, 'init'),
        }),
      ),
      ...list(field(statement, 'specifiers')).map((specifier) => ({
        name:
          field(specifier, 'exported', 'name') ??
          field(specifier, 'exported', 'value'),
        init: followed(field(specifier, 'local'), bindings),
      })),
    ])
    .flatMap(({ name, init }) =>
      typeof name === 'string' && name !== 'default' ? [{ name, init }] : [],
    );
}

export function topLevelBindings(body: readonly unknown[]): Bindings {
  return new Map(
    body.flatMap((statement) => {
      const declaration =
        field(statement, 'type') === 'ExportNamedDeclaration'
          ? field(statement, 'declaration')
          : statement;
      const functionName = field(declaration, 'id', 'name');

      if (
        field(declaration, 'type') === 'FunctionDeclaration' &&
        typeof functionName === 'string'
      ) {
        return [[functionName, declaration] as const];
      }

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

const wrappers: readonly unknown[] = [
  'TSSatisfiesExpression',
  'TSAsExpression',
  'TSNonNullExpression',
  'TSTypeAssertion',
  'ParenthesizedExpression',
];

export function unwrap(node: unknown): unknown {
  return wrappers.includes(field(node, 'type'))
    ? unwrap(field(node, 'expression'))
    : node;
}

function followed(value: unknown, bindings: Bindings): unknown {
  const name = field(value, 'name');

  return field(value, 'type') === 'Identifier' && typeof name === 'string'
    ? bindings.get(name)
    : value;
}

function withInit(value: unknown, bindings: Bindings): readonly unknown[] {
  return [value, followed(value, bindings)];
}

function isExportStory(
  name: unknown,
  includeStories: unknown,
  excludeStories: unknown,
): boolean {
  return (
    (includeStories === undefined || matchesStories(name, includeStories)) &&
    !matchesStories(name, excludeStories)
  );
}

function matchesStories(name: unknown, descriptor: unknown): boolean {
  if (field(descriptor, 'type') === 'ArrayExpression') {
    return list(field(descriptor, 'elements')).some(
      (element) => field(element, 'value') === name,
    );
  }

  const pattern =
    field(descriptor, 'type') === 'StringLiteral'
      ? field(descriptor, 'value')
      : field(descriptor, 'pattern');
  const flags = field(descriptor, 'flags') ?? '';

  return (
    typeof name === 'string' &&
    typeof pattern === 'string' &&
    typeof flags === 'string' &&
    new RegExp(pattern, flags).test(name)
  );
}

function testArguments(statement: unknown): readonly unknown[] {
  return field(statement, 'expression', 'callee', 'property', 'name') === 'test'
    ? list(field(statement, 'expression', 'arguments'))
    : [];
}

function propertyValue(object: unknown, key: string): unknown {
  const property = list(field(object, 'properties')).find(
    (candidate) => field(candidate, 'key', 'name') === key,
  );

  return field(property, 'type') === 'ObjectMethod'
    ? property
    : field(property, 'value');
}

function assigned(statement: unknown, property: string): readonly unknown[] {
  return field(statement, 'expression', 'left', 'property', 'name') === property
    ? [field(statement, 'expression', 'right')]
    : [];
}

function storyNode(init: unknown, bindings: Bindings): unknown {
  const method = field(init, 'callee', 'property', 'name');

  if (method === 'bind') {
    return followed(field(init, 'callee', 'object'), bindings);
  }

  return method === 'story' || method === 'extend'
    ? list(field(init, 'arguments'))[0]
    : init;
}

function objectOf(expression: unknown, bindings: Bindings): readonly unknown[] {
  const node = unwrap(expression);

  switch (field(node, 'type')) {
    case 'ObjectExpression': {
      return [node];
    }
    case 'Identifier': {
      return objectOf(followed(node, bindings), bindings);
    }
    default: {
      return [];
    }
  }
}
