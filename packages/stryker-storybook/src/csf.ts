import { dirname, extname, resolve } from 'node:path';

import { loadCsf } from 'storybook/internal/csf-tools';

import { isRecord, isStringArray } from './is-record.ts';
import { field, list } from './node-field.ts';

export interface IndexedStory {
  /** The story's static tags, the meta's first. */
  readonly tags: readonly string[];
  /** The name of each `.test()` call on the story that the index lists. */
  readonly tests: readonly unknown[];
}

/** The stories Storybook's CsfFile indexes; none when Storybook cannot read the file. */
export function storyIndex(
  code: string,
  fileName: string,
): ReadonlyMap<string, IndexedStory> {
  const inputs = list(indexInputs(code, fileName));

  return new Map(
    inputs.flatMap((input) => {
      const exportName = field(input, 'exportName');
      const tags = field(input, 'tags');

      return field(input, 'subtype') === 'story' &&
        typeof exportName === 'string' &&
        isStringArray(tags)
        ? [
            [
              exportName,
              {
                tags,
                tests: inputs
                  .filter(
                    (test) =>
                      field(test, 'subtype') === 'test' &&
                      field(test, 'exportName') === exportName,
                  )
                  .map((test) => field(test, 'name')),
              },
            ] as const,
          ]
        : [];
    }),
  );
}

function indexInputs(code: string, fileName: string): unknown {
  try {
    return loadCsf(code, {
      fileName,
      makeTitle: (title: string | undefined) => title ?? fileName,
    }).parse().indexInputs;
  } catch {
    return undefined;
  }
}

export interface CsfShapes {
  readonly metaObjects: ReadonlySet<unknown>;
  /** Story objects and functions, `parameters` objects that hold `__id`, and `.test()` options objects. */
  readonly literalContainers: ReadonlySet<unknown>;
  readonly testCode: ReadonlySet<unknown>;
  readonly mswValues: ReadonlySet<unknown>;
  readonly staticValues: ReadonlySet<unknown>;
}

type Bindings = ReadonlyMap<string, unknown>;

const testKeys: readonly string[] = ['play', 'beforeEach', 'afterEach'];
const staticKeys: readonly string[] = [
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
  const { metaObjects, stories: exported } = csfFile(body, bindings);
  const assignments = exported.flatMap((story) => story.assignments);
  const runtime = exported.flatMap((story) => story.runtimeAssignments);
  const stories = [
    ...exported.map(({ init }) => init),
    ...assignedIn(assignments, 'story').map(({ value }) => value),
  ]
    .map((init) => storyNode(unwrap(init), bindings))
    .filter(
      (init) =>
        (field(init, 'type') === 'ObjectExpression' ||
          field(init, 'type') === 'ArrowFunctionExpression') &&
        !metaObjects.includes(init),
    );
  const annotationsIn = (
    from: readonly Assignment[],
    key: string,
  ): readonly unknown[] =>
    [
      ...[...metaObjects, ...stories].map((owner) => propertyValue(owner, key)),
      ...assignedIn(from, key).map(({ value }) => value),
    ].flatMap((value) => withInit(value, bindings));
  const testCodeOf = (key: string): readonly unknown[] => [
    ...annotationsIn(runtime, key),
    ...assignedIn(runtime, key).map(({ statement }) => statement),
  ];
  const locals = exported.map(({ local }) => local);
  const idParameters = stories
    .map((story) => propertyValue(story, 'parameters'))
    .filter((parameters) => propertyValue(parameters, '__id') !== undefined);
  const testCalls = body
    .flatMap(testCallOf)
    .filter(({ target }) => locals.includes(target))
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
      ...testKeys.flatMap((key) => testCodeOf(key)),
      ...testCalls.flatMap(({ statement, testFunction }) => [
        statement,
        testFunction,
      ]),
    ]),
    mswValues: nodeSet(
      annotationsIn(runtime, 'parameters').flatMap((parameters) =>
        withInit(propertyValue(parameters, 'msw'), bindings),
      ),
    ),
    staticValues: nodeSet([
      ...staticKeys.flatMap((key) => annotationsIn(assignments, key)),
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

function assignedIn(
  from: readonly Assignment[],
  key: string,
): readonly Assignment[] {
  return from.filter(({ path }) => path.length === 1 && path[0] === key);
}

function nodeSet(values: readonly unknown[]): ReadonlySet<unknown> {
  return new Set(values);
}

export function defaultExport(body: readonly unknown[]): unknown {
  const declaration = field(
    body.find(
      (statement) => field(statement, 'type') === 'ExportDefaultDeclaration',
    ),
    'declaration',
  );
  const defaultSpecifier = body
    .flatMap((statement) => list(field(statement, 'specifiers')))
    .find((specifier) => field(specifier, 'exported', 'name') === 'default');

  return declaration ?? field(defaultSpecifier, 'local');
}

/** The family name of the default export, which no identifier can have. */
const defaultExportName = Symbol('export default');

export interface CsfFile {
  readonly metaObjects: readonly unknown[];
  readonly stories: readonly StoryExport[];
  /** The top-level names in a family with a written member, so what the file declares for them is not what runs. */
  readonly written: ReadonlySet<unknown>;
}

/** `index` gives the stories and their `.test()` children, as Storybook's story index lists them, in place of the package's own reading of the exports. */
export function csfFile(
  body: readonly unknown[],
  bindings: Bindings,
  index?: ReadonlyMap<string, IndexedStory>,
): CsfFile {
  const metas = factoryMetas(body, bindings);
  const metaObjects = [
    defaultExport(body),
    ...metas.map((init) => list(field(init, 'arguments'))[0]),
  ].flatMap((meta) => objectOf(meta, bindings));
  const isFactoryFile = metas.length > 0;
  const metaBindings: readonly (readonly [unknown, unknown])[] = [
    [defaultExportName, defaultExport(body)],
    ...[...bindings]
      .filter(([, init]) => metas.includes(init))
      .map(
        ([name, init]) => [name, list(field(init, 'arguments'))[0]] as const,
      ),
  ];
  const { elsewhere, written } = namesReadElsewhere(
    body,
    bindings,
    metaBindings,
  );

  return {
    metaObjects,
    stories: storyExports(
      body,
      bindings,
      isFactoryFile,
      index === undefined
        ? storyFilter(metaObjects, isFactoryFile)
        : ({ name }) => index.has(name),
      (name) => index?.get(name)?.tests ?? [],
      (local) =>
        metaBindings.some(([name]) => written.has(name)) ||
        elsewhere.has(local),
    ),
    written,
  };
}

function storyFilter(
  metaObjects: readonly unknown[],
  isFactoryFile: boolean,
): (named: NamedExport) => boolean {
  const [includeStories, excludeStories] = [
    'includeStories',
    'excludeStories',
  ].map((key) =>
    metaObjects
      .map((meta) => propertyValue(meta, key))
      .find((value) => value !== undefined),
  );

  return ({ name, init }) =>
    name !== '__namedExportsOrder' &&
    isExportStory(name, includeStories, excludeStories) &&
    (!isFactoryFile || isStoryFactoryCall(unwrap(init)));
}

function storyExports(
  body: readonly unknown[],
  bindings: Bindings,
  isFactoryFile: boolean,
  isStory: (named: NamedExport) => boolean,
  testNames: (name: string) => readonly unknown[],
  isReadElsewhere: (local: unknown) => boolean,
): readonly StoryExport[] {
  const assignments = body.flatMap(assignmentOf);
  const testCalls = body.flatMap(testCallOf);

  return namedExports(body, bindings)
    .filter(isStory)
    .map(({ name, local, init, form }) => {
      const storyAssignments = assignments.filter(
        ({ target }) => target === local,
      );
      const storyCalls = testCalls.filter(({ target }) => target === local);

      return {
        name,
        local,
        init,
        children: isStoryFactoryCall(unwrap(init))
          ? testNames(name).map((testName) => childOf(testName, storyCalls))
          : [],
        tested:
          form === 'declaration' ||
          (init !== undefined && field(init, 'type') !== 'FunctionDeclaration'),
        referencedElsewhere: isReadElsewhere(local),
        assignments: storyAssignments,
        runtimeAssignments: runtimeAssignments(storyAssignments, isFactoryFile),
        extendsBase:
          field(unwrap(init), 'callee', 'property', 'name') === 'extend',
      };
    });
}

export interface StoryExport {
  readonly name: string;
  readonly local: unknown;
  readonly init: unknown;
  /** Each `.test()` child of a factory story that the index lists; Storybook 10.6.5 runs other stories' `.test()` calls as the story itself. */
  readonly children: readonly TestChild[];
  /** Storybook 10.6.5's Vitest transform tests a story only when its export declares it or names a local variable. */
  readonly tested: boolean;
  /** The file names the story outside its declaration, its export, the `.test()` calls Storybook 10.6.5 CsfFile indexes, member assignments and the values of top-level objects, or writes to a top-level object that shares nested objects with it or with the meta, so what runs can differ from what the package reads. */
  readonly referencedElsewhere: boolean;
  readonly assignments: readonly Assignment[];
  /** The writes that the story Storybook runs is composed from, with a factory story's `input` stripped from the path. */
  readonly runtimeAssignments: readonly Assignment[];
  /** Storybook 10.6.5 `extend()` merges the base story into the new input at run time, so the argument is only part of the story. */
  readonly extendsBase: boolean;
}

/** The options argument of the `.test()` call an index row names, `undefined` for a call without one, or `'unmatched'` when that call cannot be told. */
export type TestChild = { readonly options: unknown } | 'unmatched';

/** Storybook 10.6.5 test-utils.ts `testStory` runs the first child that has the row's name. */
function childOf(testName: unknown, calls: readonly TestCall[]): TestChild {
  const call = calls.find(
    ({ args: [name] }) => field(name, 'value') === testName,
  );

  if (call === undefined) {
    return 'unmatched';
  }

  const [, ...rest] = call.args;

  return { options: rest.length > 1 ? rest[0] : undefined };
}

const storyFactories: readonly unknown[] = ['story', 'extend'];

/** Storybook 10.6.5 `isCsfFactoryCall`: a `.story()` or `.extend()` call on a plain name. */
function isStoryFactoryCall(node: unknown): boolean {
  return (
    field(node, 'callee', 'object', 'type') === 'Identifier' &&
    storyFactories.includes(field(node, 'callee', 'property', 'name'))
  );
}

const previewPath = /\/preview(.(js|jsx|mjs|ts|tsx))?$/;

/** Storybook 10.6.5 CsfFile: a top-level `X.meta()` or `X.type().meta()` call, where `X` is imported from a preview file. */
function factoryMetas(
  body: readonly unknown[],
  bindings: Bindings,
): readonly unknown[] {
  const importSources = new Map(
    body
      .filter((statement) => field(statement, 'type') === 'ImportDeclaration')
      .flatMap((statement) =>
        list(field(statement, 'specifiers')).map(
          (specifier) =>
            [
              field(specifier, 'local', 'name'),
              field(statement, 'source', 'value'),
            ] as const,
        ),
      ),
  );

  return [...bindings.values()].filter((init) => {
    const object = field(init, 'callee', 'object');
    const root =
      field(object, 'type') === 'CallExpression'
        ? field(object, 'callee', 'object')
        : object;
    const source = importSources.get(field(root, 'name'));

    return (
      field(init, 'callee', 'property', 'name') === 'meta' &&
      typeof source === 'string' &&
      previewPath.test(source)
    );
  });
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
      (statement) => field(statement, 'type') === 'ExportNamedDeclaration',
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
      ...list(field(statement, 'specifiers')).map((specifier) => ({
        name:
          field(specifier, 'exported', 'name') ??
          field(specifier, 'exported', 'value'),
        local: field(specifier, 'local', 'name'),
        init: followed(field(specifier, 'local'), bindings),
        form: 'specifier' as const,
      })),
    ])
    .flatMap(({ name, ...named }) =>
      typeof name === 'string' && name !== 'default'
        ? [{ name, ...named }]
        : [],
    );
}

export function topLevelBindings(body: readonly unknown[]): Bindings {
  return new Map(
    body.flatMap((statement) => {
      const declaration = declarationOf(statement);
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

function declarationOf(statement: unknown): unknown {
  return field(statement, 'type') === 'ExportNamedDeclaration'
    ? field(statement, 'declaration')
    : statement;
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

  return typeof name === 'string' ? bindings.get(name) : value;
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

export interface Assignment {
  readonly statement: unknown;
  readonly target: unknown;
  readonly path: readonly unknown[];
  readonly value: unknown;
}

/** Storybook 10.6.5 composes a factory story from the keys of the `input` that `defineStory` closed over, so only writes below `input` count. */
function runtimeAssignments(
  assignments: readonly Assignment[],
  isFactory: boolean,
): readonly Assignment[] {
  if (!isFactory) {
    return assignments;
  }

  return assignments.flatMap((assignment) =>
    assignment.path[0] === 'input' && assignment.path.length > 1
      ? [{ ...assignment, path: assignment.path.slice(1) }]
      : [],
  );
}

function assignmentOf(statement: unknown): readonly Assignment[] {
  const [target, ...path] = memberChain(field(statement, 'expression', 'left'));

  if (
    field(statement, 'expression', 'operator') !== '=' ||
    typeof target !== 'string'
  ) {
    return [];
  }

  return [
    {
      statement,
      target,
      path,
      value: field(statement, 'expression', 'right'),
    },
  ];
}

function memberChain(node: unknown): readonly unknown[] {
  return field(node, 'type') === 'MemberExpression'
    ? [...memberChain(field(node, 'object')), keyOf(node)]
    : [field(node, 'name')];
}

/** Storybook 10.6.5 `keyOf`: a member's name, or `undefined` when only running the file gives it. */
function keyOf(member: unknown): unknown {
  if (field(member, 'property', 'type') === 'StringLiteral') {
    return field(member, 'property', 'value');
  }

  return field(member, 'computed') === true
    ? undefined
    : field(member, 'property', 'name');
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

/** Storybook 10.6.5 CsfFile indexes a `B.test('name', ...)` statement that is a plain call with a string-literal name and two or more arguments; this check also needs no spread argument, as only running the file tells which argument a spread fills. */
function isIndexedTestCall(statement: unknown): boolean {
  const call = field(statement, 'expression');
  const args = list(field(call, 'arguments'));

  return (
    field(call, 'type') === 'CallExpression' &&
    field(call, 'callee', 'property', 'name') === 'test' &&
    args.length >= 2 &&
    field(args[0], 'type') === 'StringLiteral' &&
    !args.some((arg) => field(arg, 'type') === 'SpreadElement')
  );
}

function identifiersInReadForms(statement: unknown): readonly unknown[] {
  const declaration = declarationOf(statement);

  return [
    field(declaration, 'id'),
    ...list(field(declaration, 'declarations')).flatMap((declarator) => {
      const init = unwrap(field(declarator, 'init'));

      return [
        field(declarator, 'id'),
        field(init, 'callee', 'property', 'name') === 'story'
          ? field(init, 'callee', 'object')
          : undefined,
      ];
    }),
    ...list(field(statement, 'specifiers')).flatMap((specifier) => [
      field(specifier, 'local'),
      field(specifier, 'exported'),
    ]),
    isIndexedTestCall(statement)
      ? field(statement, 'expression', 'callee', 'object')
      : undefined,
    field(statement, 'expression', 'operator') === '='
      ? rootObject(field(statement, 'expression', 'left', 'object'))
      : undefined,
  ];
}

function rootObject(node: unknown): unknown {
  return field(node, 'type') === 'MemberExpression'
    ? rootObject(field(node, 'object'))
    : node;
}

/** `elsewhere` holds the names the file uses outside the forms the package reads, plus every name in a family of two or more that has a written member; `written` holds every name in a written family. A shadowing local or an object key counts too, as no scopes are resolved. The meta joins the families as the default export and as each factory meta. */
function namesReadElsewhere(
  body: readonly unknown[],
  bindings: Bindings,
  metaBindings: readonly (readonly [unknown, unknown])[],
): {
  readonly elsewhere: ReadonlySet<unknown>;
  readonly written: ReadonlySet<unknown>;
} {
  const reaches = reachesOf([...bindings, ...metaBindings], bindings);
  const read = new Set([
    ...body.flatMap(identifiersInReadForms),
    ...reaches.map(({ identifier }) => identifier),
  ]);
  const referenced = identifiersIn(body)
    .filter((identifier) => !read.has(identifier))
    .map((identifier) => field(identifier, 'name'));
  const written = withFamilies(
    new Set([
      ...referenced,
      ...body.flatMap(assignmentOf).map(({ target }) => target),
    ]),
    reaches,
  );

  return {
    elsewhere: new Set([
      ...referenced,
      ...reaches
        .filter(({ from }) => written.has(from))
        .flatMap(({ from, to }) => [from, to]),
    ]),
    written,
  };
}

function withFamilies(
  names: ReadonlySet<unknown>,
  reaches: readonly Reach[],
): ReadonlySet<unknown> {
  const reached = reaches
    .filter(({ from, to }) => names.has(from) !== names.has(to))
    .flatMap(({ from, to }) => [from, to]);

  return reached.length === 0
    ? names
    : withFamilies(new Set([...names, ...reached]), reaches);
}

interface Reach {
  readonly from: unknown;
  readonly to: string;
  readonly identifier: unknown;
}

/** A top-level `const C = { ...A, b: { c: B } }` or `const C = A` shares A's and B's nested objects with C, so a write through any of them changes what the others run with. */
function reachesOf(
  inits: readonly (readonly [unknown, unknown])[],
  bindings: Bindings,
): readonly Reach[] {
  return inits.flatMap(([from, init]) =>
    identifiersReachedFrom(init).flatMap((identifier) => {
      const to = field(identifier, 'name');

      return typeof to === 'string' && bindings.has(to)
        ? [{ from, to, identifier }]
        : [];
    }),
  );
}

/** The identifiers `evaluate` in reset-setting.ts follows from a value. */
function identifiersReachedFrom(node: unknown): readonly unknown[] {
  const current = unwrap(node);

  if (field(current, 'type') === 'Identifier') {
    return [current];
  }

  return list(field(current, 'properties')).flatMap((property) =>
    identifiersReachedFrom(
      field(
        property,
        field(property, 'type') === 'SpreadElement' ? 'argument' : 'value',
      ),
    ),
  );
}

function identifiersIn(node: unknown): readonly unknown[] {
  if (!isRecord(node)) {
    return [];
  }

  if (node['type'] === 'Identifier') {
    return [node];
  }

  if (node['type'] === 'TSTypeQuery') {
    return [];
  }

  if (node['type'] === 'MemberExpression' && node['computed'] === false) {
    return identifiersIn(node['object']);
  }

  return Object.values(node).flatMap(identifiersIn);
}

/** The file holds a string literal that names this file, or loads a module whose specifier is not a string literal. Storybook 10.6.5's Vitest transform composes each story from the file's own bindings, so a write through an import of the file itself changes what runs without naming the story. */
export function mayImportItself(
  body: readonly unknown[],
  fileName: string,
): boolean {
  const file = resolve(fileName);
  const withoutExtension = file.slice(0, file.length - extname(file).length);
  const nodes = nodesIn(body);
  const namesThisFile = (specifier: unknown): boolean => {
    if (typeof specifier !== 'string' || !specifier.startsWith('.')) {
      return false;
    }

    const target = resolve(dirname(file), specifier);

    // Vite resolves a .js, .jsx, .mjs or .cjs specifier to the TypeScript file of the same name.
    return (
      [file, withoutExtension].includes(target) ||
      target.replace(/\.[cm]?jsx?$/, '') === withoutExtension
    );
  };

  return (
    nodes
      .filter((node) => field(node, 'type') === 'StringLiteral')
      .some((literal) => namesThisFile(field(literal, 'value'))) ||
    nodes
      .filter(
        (node) =>
          field(node, 'callee', 'type') === 'Import' ||
          field(node, 'callee', 'name') === 'require',
      )
      .some(
        (call) =>
          field(list(field(call, 'arguments'))[0], 'type') !== 'StringLiteral',
      )
  );
}

function nodesIn(node: unknown): readonly unknown[] {
  return isRecord(node) ? [node, ...Object.values(node).flatMap(nodesIn)] : [];
}

function propertyValue(object: unknown, key: string): unknown {
  const property = list(field(object, 'properties')).find(
    (candidate) => field(candidate, 'key', 'name') === key,
  );

  return field(property, 'type') === 'ObjectMethod'
    ? property
    : field(property, 'value');
}

function storyNode(init: unknown, bindings: Bindings): unknown {
  if (isTemplateBind(init)) {
    return followed(field(init, 'callee', 'object'), bindings);
  }

  return storyArgument(init);
}

export function storyArgument(init: unknown): unknown {
  const current = unwrap(init);

  return isStoryFactoryCall(current)
    ? list(field(current, 'arguments'))[0]
    : current;
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
