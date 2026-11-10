export interface CsfShapes {
  readonly metaObjects: ReadonlySet<unknown>;
  /** Story objects and functions, `parameters` objects that hold `__id`, and `.test()` options objects. */
  readonly literalContainers: ReadonlySet<unknown>;
  readonly testCode: ReadonlySet<unknown>;
  readonly mswValues: ReadonlySet<unknown>;
  readonly staticValues: ReadonlySet<unknown>;
}

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
    ...objectOf(declaration ?? field(defaultSpecifier, 'local'), body),
    ...body
      .flatMap((statement) => [
        ...list(field(statement, 'declarations')),
        ...list(field(statement, 'declaration', 'declarations')),
      ])
      .map((declarator) => field(declarator, 'init'))
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
  const stories = [
    ...body.flatMap((statement) => [
      ...list(field(statement, 'declaration', 'declarations')).map(
        (declarator) => ({
          name: field(declarator, 'id', 'name'),
          init: field(declarator, 'init'),
        }),
      ),
      ...assigned(statement, 'story').map((init) => ({
        name: field(statement, 'expression', 'left', 'object', 'name'),
        init,
      })),
    ]),
    ...specifiers.map((specifier) => ({
      name:
        field(specifier, 'exported', 'name') ??
        field(specifier, 'exported', 'value'),
      init: initOf(field(specifier, 'local', 'name'), body),
    })),
  ]
    .filter(({ name }) => isExportStory(name, includeStories, excludeStories))
    .map(({ init }) => storyNode(unwrap(init), body))
    .filter(
      (init) =>
        (field(init, 'type') === 'ObjectExpression' ||
          field(init, 'type') === 'ArrowFunctionExpression') &&
        !metaObjects.includes(init),
    );
  const idParameters = stories
    .map((story) => propertyValue(story, 'parameters'))
    .filter((parameters) => propertyValue(parameters, '__id') !== undefined);
  const testStatements = body.filter(
    (statement) => testArguments(statement).length > 0,
  );
  const testCalls = testStatements.map(testArguments);
  const testOptions = testCalls
    .filter((testArgs) => testArgs.length === 3)
    .map((testArgs) => followed(testArgs[1], body));

  return {
    metaObjects: nodeSet(metaObjects),
    literalContainers: nodeSet([...stories, ...idParameters, ...testOptions]),
    testCode: nodeSet([
      ...[...metaObjects, ...stories].flatMap((object) =>
        testKeys.flatMap((key) => withInit(propertyValue(object, key), body)),
      ),
      ...body.flatMap((statement) =>
        testKeys.flatMap((key) =>
          assigned(statement, key).flatMap((value) => withInit(value, body)),
        ),
      ),
      ...testStatements,
    ]),
    mswValues: nodeSet(
      [
        ...stories.map((story) => propertyValue(story, 'parameters')),
        ...body.flatMap((statement) => assigned(statement, 'parameters')),
      ].map((parameters) => propertyValue(parameters, 'msw')),
    ),
    staticValues: nodeSet([
      ...[...metaObjects, ...stories].flatMap((object) =>
        staticKeys.flatMap((key) => withInit(propertyValue(object, key), body)),
      ),
      ...idParameters.map((parameters) => propertyValue(parameters, '__id')),
      ...body.flatMap((statement) => [
        ...assigned(statement, 'storyName'),
        ...assigned(statement, 'tags').flatMap((tags) => withInit(tags, body)),
      ]),
      initOf('__namedExportsOrder', body),
      ...testCalls.map((testArgs) => testArgs[0]),
      ...testOptions.flatMap((options) =>
        withInit(propertyValue(options, 'tags'), body),
      ),
      ...specifiers.map((specifier) => field(specifier, 'exported')),
    ]),
  };
}

function nodeSet(values: readonly unknown[]): ReadonlySet<unknown> {
  return new Set(values.filter((value) => value !== undefined));
}

function withInit(
  value: unknown,
  body: readonly unknown[],
): readonly unknown[] {
  return [value, followed(value, body)];
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

function followed(value: unknown, body: readonly unknown[]): unknown {
  return field(value, 'type') === 'Identifier'
    ? initOf(field(value, 'name'), body)
    : value;
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

function storyNode(init: unknown, body: readonly unknown[]): unknown {
  const method = field(init, 'callee', 'property', 'name');

  if (method === 'bind') {
    return followed(field(init, 'callee', 'object'), body);
  }

  return method === 'story' || method === 'extend'
    ? list(field(init, 'arguments'))[0]
    : init;
}

function unwrap(node: unknown): unknown {
  return field(node, 'type') === 'TSSatisfiesExpression'
    ? field(node, 'expression')
    : node;
}

function objectOf(
  expression: unknown,
  body: readonly unknown[],
): readonly unknown[] {
  const node = unwrap(expression);

  switch (field(node, 'type')) {
    case 'ObjectExpression': {
      return [node];
    }
    case 'Identifier': {
      return objectOf(initOf(field(node, 'name'), body), body);
    }
    default: {
      return [];
    }
  }
}

function initOf(name: unknown, body: readonly unknown[]): unknown {
  return field(
    body
      .flatMap((statement) => [
        ...list(field(statement, 'declarations')),
        ...list(field(statement, 'declaration', 'declarations')),
      ])
      .find((declarator) => field(declarator, 'id', 'name') === name),
    'init',
  );
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
