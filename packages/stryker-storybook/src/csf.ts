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
  const specifiers = body.flatMap((statement) =>
    list(field(statement, 'specifiers')),
  );
  const metaObjects = metaObjectsOf(body, bindings);
  const isStory = storyFilter(metaObjects);
  const assignments = body.map(assignmentOf);
  const storyInits = [
    ...storyExports(body, bindings),
    ...assignments
      .filter(({ target, key }) => key === 'story' && isStory(target))
      .map(({ target, value }) => ({ name: target, init: value })),
  ];
  const storyNames = storyInits.map(({ name }) => name);
  const stories = storyInits
    .map(({ init }) => storyNode(unwrap(init), bindings))
    .filter(
      (init) =>
        (field(init, 'type') === 'ObjectExpression' ||
          field(init, 'type') === 'ArrowFunctionExpression') &&
        !metaObjects.includes(init),
    );
  const storyAssignments = assignments.filter(({ target }) =>
    storyNames.includes(target),
  );
  const storyAnnotations = (key: string): readonly unknown[] =>
    [
      ...stories.map((story) => propertyValue(story, key)),
      ...storyAssignments
        .filter((assignment) => assignment.key === key)
        .map(({ value }) => value),
    ].flatMap((value) => withInit(value, bindings));
  const annotations = (key: string): readonly unknown[] => [
    ...metaObjects.flatMap((meta) =>
      withInit(propertyValue(meta, key), bindings),
    ),
    ...storyAnnotations(key),
  ];
  const idParameters = stories
    .map((story) => propertyValue(story, 'parameters'))
    .filter((parameters) => propertyValue(parameters, '__id') !== undefined);
  const testCalls = body
    .flatMap(testCallOf)
    .filter(({ target }) => storyNames.includes(target))
    .flatMap(({ statement, args: [name, ...rest] }) =>
      name === undefined
        ? []
        : [
            {
              statement,
              name,
              options:
                rest.length > 1 ? followed(rest[0], bindings) : undefined,
              testFunction: followed(rest.at(-1), bindings),
            },
          ],
    );

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

function metaObjectsOf(
  body: readonly unknown[],
  bindings: Bindings,
): readonly unknown[] {
  return metaExpressions(body, bindings).flatMap((meta) =>
    objectOf(meta, bindings),
  );
}

export function metaExpressions(
  body: readonly unknown[],
  bindings: Bindings,
): readonly unknown[] {
  const declaration = field(
    body.find(
      (statement) => field(statement, 'type') === 'ExportDefaultDeclaration',
    ),
    'declaration',
  );
  const defaultSpecifier = body
    .flatMap((statement) => list(field(statement, 'specifiers')))
    .find((specifier) => field(specifier, 'exported', 'name') === 'default');

  return [
    declaration ?? field(defaultSpecifier, 'local'),
    ...[...bindings.values()]
      .filter(isFactoryMeta)
      .map((init) => list(field(init, 'arguments'))[0]),
  ].filter((meta) => meta !== undefined);
}

function storyFilter(
  metaObjects: readonly unknown[],
): (name: unknown) => boolean {
  const [includeStories, excludeStories] = [
    'includeStories',
    'excludeStories',
  ].map((key) =>
    metaObjects
      .map((meta) => propertyValue(meta, key))
      .find((value) => value !== undefined),
  );

  return (name) => isExportStory(name, includeStories, excludeStories);
}

export function storyExports(
  body: readonly unknown[],
  bindings: Bindings,
): readonly StoryExport[] {
  const isStory = storyFilter(metaObjectsOf(body, bindings));
  const exports = namedExports(body, bindings);
  const isFactoryStory = ({ init }: NamedExport): boolean =>
    storyFactories.includes(field(unwrap(init), 'callee', 'property', 'name'));
  const isFactoryFile = exports.some(isFactoryStory);

  return exports
    .filter(
      (named) =>
        named.name !== '__namedExportsOrder' &&
        isStory(named.name) &&
        (!isFactoryFile || isFactoryStory(named)),
    )
    .map(({ name, local, init, form }) => ({
      name,
      local,
      init,
      tested:
        form === 'declaration' ||
        (init !== undefined && field(init, 'type') !== 'FunctionDeclaration'),
    }));
}

export interface StoryExport {
  readonly name: string;
  readonly local: unknown;
  readonly init: unknown;
  /** Storybook 10.6.5's Vitest transform tests a story only when its export declares it or names a local variable. */
  readonly tested: boolean;
}

const storyFactories: readonly unknown[] = ['story', 'extend'];

function isFactoryMeta(init: unknown): boolean {
  return field(init, 'callee', 'property', 'name') === 'meta';
}

export interface NamedExport {
  readonly name: string;
  readonly local: unknown;
  readonly init: unknown;
  readonly form: 'declaration' | 'specifier';
}

export function namedExports(
  body: readonly unknown[],
  bindings: Bindings,
): readonly NamedExport[] {
  return body
    .filter(
      (statement) =>
        field(statement, 'type') === 'ExportNamedDeclaration' &&
        field(statement, 'exportKind') !== 'type',
    )
    .flatMap((statement) => [
      ...list(field(statement, 'declaration', 'declarations')).map(
        (declarator) => ({
          name: field(declarator, 'id', 'name'),
          local: field(declarator, 'id', 'name'),
          init: field(declarator, 'init'),
          form: 'declaration' as const,
        }),
      ),
      ...(field(statement, 'declaration', 'type') === 'FunctionDeclaration'
        ? [
            {
              name: field(statement, 'declaration', 'id', 'name'),
              local: field(statement, 'declaration', 'id', 'name'),
              init: field(statement, 'declaration'),
              form: 'declaration' as const,
            },
          ]
        : []),
      ...list(field(statement, 'specifiers'))
        .filter((specifier) => field(specifier, 'exportKind') !== 'type')
        .map((specifier) => ({
          name:
            field(specifier, 'exported', 'name') ??
            field(specifier, 'exported', 'value'),
          local: field(specifier, 'local', 'name'),
          init: followed(field(specifier, 'local'), bindings),
          form: 'specifier' as const,
        })),
    ])
    .flatMap(({ name, ...named }) =>
      typeof name === 'string' && name !== 'default' ? [{ name, ...named }] : [],
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

/** The bindings a name's init reads, so that following a cycle of names ends. */
export function withoutBinding(bindings: Bindings, name: unknown): Bindings {
  return new Map([...bindings].filter(([bound]) => bound !== name));
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

interface Assignment {
  readonly target: unknown;
  /** The one key of a `Target.key = value` assignment. */
  readonly key: unknown;
  readonly path: readonly unknown[];
  readonly value: unknown;
}

export function assignmentOf(statement: unknown): Assignment {
  const [target, ...path] = memberChain(
    field(statement, 'expression', 'left'),
  );

  return {
    target,
    key: path.length === 1 ? path[0] : undefined,
    path,
    value: field(statement, 'expression', 'right'),
  };
}

function memberChain(node: unknown): readonly unknown[] {
  return field(node, 'type') === 'MemberExpression'
    ? [...memberChain(field(node, 'object')), field(node, 'property', 'name')]
    : [field(node, 'name')];
}

interface TestCall {
  readonly statement: unknown;
  readonly target: unknown;
  readonly args: readonly unknown[];
}

function testCallOf(statement: unknown): readonly TestCall[] {
  const callee = field(statement, 'expression', 'callee');

  return field(callee, 'property', 'name') === 'test'
    ? [
        {
          statement,
          target: field(callee, 'object', 'name'),
          args: list(field(statement, 'expression', 'arguments')),
        },
      ]
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

export const annotationFactories: readonly unknown[] = [
  'definePreview',
  'meta',
  'story',
];

function storyNode(init: unknown, bindings: Bindings): unknown {
  if (isTemplateBind(init)) {
    return followed(field(init, 'callee', 'object'), bindings);
  }

  const method = field(init, 'callee', 'property', 'name');

  return method === 'extend' || annotationFactories.includes(method)
    ? list(field(init, 'arguments'))[0]
    : init;
}

export function isTemplateBind(init: unknown): boolean {
  const [context, ...more] = list(field(init, 'arguments'));

  return (
    field(init, 'callee', 'property', 'name') === 'bind' &&
    more.length === 0 &&
    (context === undefined ||
      (field(context, 'type') === 'ObjectExpression' &&
        list(field(context, 'properties')).length === 0))
  );
}

function objectOf(expression: unknown, bindings: Bindings): readonly unknown[] {
  const node = unwrap(expression);

  switch (field(node, 'type')) {
    case 'ObjectExpression': {
      return [node];
    }
    case 'Identifier': {
      return objectOf(
        followed(node, bindings),
        withoutBinding(bindings, field(node, 'name')),
      );
    }
    default: {
      return [];
    }
  }
}
