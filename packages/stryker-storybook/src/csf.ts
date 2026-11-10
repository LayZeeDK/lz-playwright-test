export interface CsfShapes {
  readonly metaObjects: ReadonlySet<unknown>;
}

export function csfShapes(program: unknown): CsfShapes {
  const body = list(field(program, 'body'));
  const declaration = field(
    body.find(
      (statement) => field(statement, 'type') === 'ExportDefaultDeclaration',
    ),
    'declaration',
  );

  return { metaObjects: new Set(objectOf(declaration, body)) };
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
