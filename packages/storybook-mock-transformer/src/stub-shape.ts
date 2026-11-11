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
  readonly end: number;
  readonly line: number;
  readonly argumentStart: number | undefined;
}

const functionType = /Function|ObjectMethod|ClassMethod|ClassPrivateMethod/;

export function definitionTimeStubs(program: unknown): readonly StubSite[] {
  return collectStubs(program, storybookTestFnNames(program));
}

function storybookTestFnNames(program: unknown): ReadonlySet<string> {
  return new Set(
    list(field(program, 'body'))
      .filter(
        (statement) => field(statement, 'source', 'value') === 'storybook/test',
      )
      .flatMap((statement) => list(field(statement, 'specifiers')))
      .filter((specifier) => field(specifier, 'imported', 'name') === 'fn')
      .map((specifier) => field(specifier, 'local', 'name'))
      .filter((local) => typeof local === 'string'),
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
  const end = field(node, 'end');
  const line = field(node, 'loc', 'start', 'line');
  const spy = field(node, 'callee', 'object', 'callee', 'name');
  const name = field(node, 'callee', 'property', 'name');
  const method = stubMethods.find(
    (candidate) => name === candidate || name === `${candidate}Once`,
  );

  if (
    !isCall(node) ||
    typeof start !== 'number' ||
    typeof end !== 'number' ||
    typeof line !== 'number' ||
    field(node, 'callee', 'computed') === true ||
    !isCall(field(node, 'callee', 'object')) ||
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
    end,
    line,
    argumentStart:
      typeof argumentStart === 'number' ? argumentStart : undefined,
  };
}

function isCall(node: unknown): boolean {
  const type = field(node, 'type');

  return type === 'CallExpression' || type === 'OptionalCallExpression';
}

function field(node: unknown, ...keys: readonly string[]): unknown {
  return keys.reduce<unknown>(
    (value, key) => (isRecord(value) ? value[key] : undefined),
    node,
  );
}

function list(value: unknown): readonly unknown[] {
  // Stryker disable next-line ArrayDeclaration: the only non-array input is a missing specifiers list, and a string element has no imported name
  return Array.isArray(value) ? value : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
