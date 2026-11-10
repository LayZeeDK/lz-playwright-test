const stubMethods = [
  'mockReturnValue',
  'mockResolvedValue',
  'mockRejectedValue',
  'mockImplementation',
] as const;

export type StubMethod = (typeof stubMethods)[number];

export interface StubSite {
  readonly spy: string;
  readonly method: StubMethod;
  readonly once: boolean;
  readonly start: number;
  readonly argumentStart: number | undefined;
}

const functionType = /Function|ObjectMethod|ClassMethod|ClassPrivateMethod/;

export function definitionTimeStubs(program: unknown): readonly StubSite[] {
  return collectStubs(program, storybookTestFnNames(program));
}

function storybookTestFnNames(program: unknown): ReadonlySet<string> {
  return new Set(
    list(field(program, 'body')).flatMap((statement) =>
      field(statement, 'type') === 'ImportDeclaration' &&
      field(statement, 'source', 'value') === 'storybook/test'
        ? list(field(statement, 'specifiers')).flatMap((specifier) => {
            const local = field(specifier, 'local', 'name');

            return field(specifier, 'type') === 'ImportSpecifier' &&
              field(specifier, 'imported', 'name') === 'fn' &&
              typeof local === 'string'
              ? [local]
              : [];
          })
        : [],
    ),
  );
}

function collectStubs(
  node: unknown,
  spies: ReadonlySet<string>,
): readonly StubSite[] {
  const type = field(node, 'type');

  if (!isRecord(node) || typeof type !== 'string' || functionType.test(type)) {
    return [];
  }

  const site = stubSite(node, spies);
  const children: readonly unknown[] = Object.values(node).flatMap(
    (value: unknown) => (Array.isArray(value) ? list(value) : [value]),
  );

  return [
    ...(site ? [site] : []),
    ...children.flatMap((child) => collectStubs(child, spies)),
  ];
}

function stubSite(
  node: unknown,
  spies: ReadonlySet<string>,
): StubSite | undefined {
  const start = field(node, 'start');
  const spy = field(node, 'callee', 'object', 'callee', 'name');
  const name = field(node, 'callee', 'property', 'name');
  const method = stubMethods.find(
    (candidate) => name === candidate || name === `${candidate}Once`,
  );

  if (
    field(node, 'type') !== 'CallExpression' ||
    typeof start !== 'number' ||
    field(node, 'callee', 'type') !== 'MemberExpression' ||
    field(node, 'callee', 'computed') === true ||
    field(node, 'callee', 'object', 'type') !== 'CallExpression' ||
    field(node, 'callee', 'object', 'callee', 'type') !== 'Identifier' ||
    typeof spy !== 'string' ||
    !spies.has(spy) ||
    method === undefined
  ) {
    return undefined;
  }

  const argumentStart = field(node, 'arguments', '0', 'start');

  return {
    spy,
    method,
    once: name !== method,
    start,
    argumentStart:
      typeof argumentStart === 'number' ? argumentStart : undefined,
  };
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
