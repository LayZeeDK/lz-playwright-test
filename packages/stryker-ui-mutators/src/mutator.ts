import type { NodePath, types } from '@babel/core';

export type BabelTypes = typeof types;

export interface Operator {
  readonly name: string;
  readonly sample: string;
  readonly rules: readonly Rule[];
}

// In place of `as const`: Stryker mutates nothing inside an `as` expression, which would leave every rule of the
// table out of a mutation run.
export function operatorTable<const T extends readonly Operator[]>(
  table: T,
): T {
  return table;
}

export type Rule = AttributeRule | NodeRule;

export interface AttributeRule {
  readonly kind: 'attribute';
  readonly attributes: readonly string[] | RegExp;
  readonly on: {
    readonly bare?: 'remove';
    readonly string?: 'empty' | 'remove' | 'flip';
    readonly expression?: 'empty' | 'remove' | 'false' | 'negate';
  };
  skip?(site: AttributeSite, t: BabelTypes): boolean;
}

export interface NodeRule {
  readonly kind: 'node';
  mutate(path: NodePath, t: BabelTypes): Iterable<types.Node>;
}

export interface AttributeSite {
  readonly name: string;
  readonly value: AttributeValue;
  readonly element: ElementSite;
  readonly path: NodePath<types.JSXAttribute>;
}

export type AttributeValue =
  | { readonly kind: 'bare' }
  | { readonly kind: 'string'; readonly text: string }
  | { readonly kind: 'expression'; readonly expression: types.Expression };

export interface ElementSite {
  readonly name: string | undefined;
  readonly attributes: ReadonlySet<string>;
  readonly node: types.JSXElement;
}

type Replacement = 'empty' | 'remove' | 'false' | 'negate' | 'flip';

export interface NodeMutatorLike {
  readonly name: string;
  mutate(
    path: NodePath,
    context: { isExpressionContext: boolean },
  ): Iterable<types.Node>;
}

export function toNodeMutator(
  operator: Operator,
  t: BabelTypes,
): NodeMutatorLike {
  return {
    name: operator.name,
    *mutate(path) {
      const site = attributeSite(path, t);

      for (const rule of operator.rules) {
        if (rule.kind === 'node') {
          yield* rule.mutate(path, t);
          continue;
        }

        if (
          site === undefined ||
          !matches(rule.attributes, site.name) ||
          rule.skip?.(site, t) === true
        ) {
          continue;
        }

        const replacement: Replacement | undefined = rule.on[site.value.kind];

        if (replacement !== undefined) {
          yield* replaced(site, replacement, t);
        }
      }
    },
  };
}

function matches(
  attributes: AttributeRule['attributes'],
  name: string,
): boolean {
  return attributes instanceof RegExp
    ? attributes.test(name)
    : attributes.includes(name);
}

function attributeSite(
  path: NodePath,
  t: BabelTypes,
): AttributeSite | undefined {
  if (!path.isJSXAttribute() || !t.isJSXIdentifier(path.node.name)) {
    return undefined;
  }

  const value = readValue(path.node.value, t);
  const element = elementSiteOf(path.parentPath.parentPath?.node, t);

  return value === undefined || element === undefined
    ? undefined
    : { name: path.node.name.name, value, element, path };
}

export function elementSiteOf(
  node: types.Node | null | undefined,
  t: BabelTypes,
): ElementSite | undefined {
  if (!t.isJSXElement(node)) {
    return undefined;
  }

  const { name, attributes } = node.openingElement;
  const names = attributes.flatMap((entry) =>
    t.isJSXAttribute(entry) && t.isJSXIdentifier(entry.name)
      ? [entry.name.name]
      : [],
  );

  return {
    name: t.isJSXIdentifier(name) ? name.name : undefined,
    attributes: new Set(names),
    node,
  };
}

export function decodeValue(
  value: types.JSXAttribute['value'],
  t: BabelTypes,
): AttributeValue | { readonly kind: 'other' } {
  if (value === null || value === undefined) {
    return { kind: 'bare' };
  }

  if (t.isStringLiteral(value)) {
    return { kind: 'string', text: value.value };
  }

  return t.isJSXExpressionContainer(value) &&
    !t.isJSXEmptyExpression(value.expression)
    ? { kind: 'expression', expression: value.expression }
    : { kind: 'other' };
}

function readValue(
  value: types.JSXAttribute['value'],
  t: BabelTypes,
): AttributeValue | undefined {
  const decoded = decodeValue(value, t);

  if (decoded.kind === 'other') {
    return undefined;
  }

  // The built-in StringLiteral, BooleanLiteral, ArrowFunction and BlockStatement mutators own these.
  return decoded.kind === 'expression' &&
    (t.isLiteral(decoded.expression) || t.isFunction(decoded.expression))
    ? undefined
    : decoded;
}

function* replaced(
  site: AttributeSite,
  replacement: Replacement,
  t: BabelTypes,
): Iterable<types.JSXAttribute> {
  const name = t.jsxIdentifier(site.name);
  const { value } = site;

  switch (replacement) {
    case 'empty': {
      if (value.kind !== 'string' || value.text !== '') {
        yield t.jsxAttribute(name, t.stringLiteral(''));
      }

      return;
    }

    case 'remove': {
      yield t.jsxAttribute(
        name,
        t.jsxExpressionContainer(t.identifier('undefined')),
      );

      return;
    }

    case 'false': {
      yield t.jsxAttribute(
        name,
        t.jsxExpressionContainer(t.booleanLiteral(false)),
      );

      return;
    }

    case 'negate': {
      const negated =
        value.kind === 'expression' ? negation(value.expression, t) : undefined;

      if (negated !== undefined) {
        yield t.jsxAttribute(name, t.jsxExpressionContainer(negated));
      }

      return;
    }

    case 'flip': {
      if (value.kind === 'string') {
        yield t.jsxAttribute(
          name,
          t.stringLiteral(value.text === 'true' ? 'false' : 'true'),
        );
      }

      return;
    }
  }
}

// `!(expr)` is always false for a string value, as in `!(c ? 'true' : 'false')` and `!String(open)`.
function negation(
  expression: types.Expression,
  t: BabelTypes,
): types.Expression | undefined {
  const value = withoutTypeWrapper(expression, t);

  if (t.isConditionalExpression(value)) {
    const consequent = negation(value.consequent, t);
    const alternate = negation(value.alternate, t);

    return consequent === undefined && alternate === undefined
      ? undefined
      : t.conditionalExpression(
          t.cloneNode(value.test, true),
          consequent ?? t.cloneNode(value.consequent, true),
          alternate ?? t.cloneNode(value.alternate, true),
        );
  }

  if (t.isStringLiteral(value)) {
    return t.stringLiteral(value.value === 'true' ? 'false' : 'true');
  }

  if (t.isBooleanLiteral(value)) {
    return t.booleanLiteral(!value.value);
  }

  if (
    t.isLiteral(value) ||
    t.isIdentifier(value, { name: 'undefined' }) ||
    isStringCall(value, t)
  ) {
    return undefined;
  }

  return t.unaryExpression('!', t.cloneNode(expression, true));
}

function withoutTypeWrapper(
  expression: types.Expression,
  t: BabelTypes,
): types.Expression {
  return t.isTSAsExpression(expression) ||
    t.isTSSatisfiesExpression(expression) ||
    t.isTSNonNullExpression(expression)
    ? withoutTypeWrapper(expression.expression, t)
    : expression;
}

function isStringCall(expression: types.Expression, t: BabelTypes): boolean {
  if (
    !t.isCallExpression(expression) &&
    !t.isOptionalCallExpression(expression)
  ) {
    return false;
  }

  const { callee } = expression;

  return (
    t.isIdentifier(callee, { name: 'String' }) ||
    ((t.isMemberExpression(callee) || t.isOptionalMemberExpression(callee)) &&
      t.isIdentifier(callee.property, { name: 'toString' }))
  );
}

export function isJsxChild(path: NodePath): boolean {
  return (
    path.parentPath?.isJSXElement() === true ||
    path.parentPath?.isJSXFragment() === true
  );
}
