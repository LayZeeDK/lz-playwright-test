export interface CsfShapes {
  readonly metaObjects: ReadonlySet<unknown>;
  readonly storyContainers: ReadonlySet<unknown>;
  readonly testCode: ReadonlySet<unknown>;
  readonly mswValues: ReadonlySet<unknown>;
}

const testKeys = ['play', 'beforeEach', 'afterEach'];

export function csfShapes(program: unknown): CsfShapes {
  const body = list(field(program, 'body'));
  const declaration = field(
    body.find(
      (statement) => field(statement, 'type') === 'ExportDefaultDeclaration',
    ),
    'declaration',
  );

  const stories = body
    .flatMap((statement) => [
      ...list(field(statement, 'declaration', 'declarations')).map(
        (declarator) => field(declarator, 'init'),
      ),
      ...list(field(statement, 'specifiers')).map((specifier) =>
        initOf(field(specifier, 'local', 'name'), body),
      ),
      ...assigned(statement, 'story'),
    ])
    .map((init) => storyNode(unwrap(init)))
    .filter(
      (init) =>
        field(init, 'type') === 'ObjectExpression' ||
        field(init, 'type') === 'ArrowFunctionExpression',
    );
  const idParameters = stories
    .map((story) => propertyValue(story, 'parameters'))
    .filter((parameters) => propertyValue(parameters, '__id') !== undefined);
  const testOptions = body
    .map(testArguments)
    .filter((testArgs) => testArgs.length === 3)
    .map((testArgs) => testArgs[1]);

  return {
    metaObjects: new Set(objectOf(declaration, body)),
    storyContainers: new Set([...stories, ...idParameters, ...testOptions]),
    testCode: new Set([
      ...stories.flatMap((story) =>
        testKeys.map((key) => propertyValue(story, key)),
      ),
      ...body.flatMap((statement) =>
        testKeys.flatMap((key) => assigned(statement, key)),
      ),
      ...body.map(testArguments).map((testArgs) => testArgs.at(-1)),
    ]),
    mswValues: new Set(
      [
        ...stories.map((story) => propertyValue(story, 'parameters')),
        ...body.flatMap((statement) => assigned(statement, 'parameters')),
      ].map((parameters) => propertyValue(parameters, 'msw')),
    ),
  };
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

function storyNode(init: unknown): unknown {
  const method = field(init, 'callee', 'property', 'name');

  return method === 'story' || method === 'extend'
    ? list(field(init, 'arguments'))[0]
    : init;
}

function unwrap(node: unknown): unknown {
  return field(node, 'type') === 'TSSatisfiesExpression'
    ? field(node, 'expression')
    : node;
}

function objectOf(node: unknown, body: readonly unknown[]): readonly unknown[] {
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
