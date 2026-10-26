// The operator table's types and the one interpreter that turns a table row into a Stryker NodeMutator. Free of
// Stryker: Babel's types arrive as an argument.
import type { NodePath, types } from '@babel/core';

export type BabelTypes = typeof types;

/** One UI mutation operator: a row of the table in operators.ts. */
export interface Operator {
  /** Letters only (Stryker directives match no other character); what reports, `excludedMutations` and directives use. */
  readonly name: string;
  /** A TSX module in which the operator makes at least one mutant; the install's self-check instruments it. */
  readonly sample: string;
  readonly rules: readonly Rule[];
}

/**
 * The table as written, its names kept as literal types. In place of `as const`: Stryker mutates nothing inside an
 * `as` expression, which would leave every rule of the table out of a mutation run.
 */
export function operatorTable<const T extends readonly Operator[]>(
  table: T,
): T {
  return table;
}

export type Rule = AttributeRule | NodeRule;

/**
 * A rule stated as data: which JSX attributes it matches and what each kind of value becomes. Values that are
 * literals in braces, template literals or functions never reach it (see `readValue`): the built-in
 * StringLiteral, BooleanLiteral, ArrowFunction and BlockStatement own them.
 */
export interface AttributeRule {
  readonly kind: 'attribute';
  /** Plain `JSXIdentifier` names; a namespaced name (`xlink:href`) never matches. */
  readonly attributes: readonly string[] | RegExp;
  /** The replacement per value kind. A kind left out gives no mutant. The types allow only replacements that fit the kind. */
  readonly on: {
    readonly bare?: 'remove';
    readonly string?: 'empty' | 'remove' | 'flip';
    readonly expression?: 'empty' | 'remove' | 'false' | 'negate';
  };
  /** An equivalent-mutant skip that needs the element, its other attributes, or the scope (through `site.path`). */
  skip?(site: AttributeSite): boolean;
}

/** A rule that needs the shape of the tree around a node; it yields each replacement node. */
export interface NodeRule {
  readonly kind: 'node';
  mutate(path: NodePath, t: BabelTypes): Iterable<types.Node>;
}

/** A matched attribute, parsed once by the interpreter so that rules never re-read raw Babel shapes. */
export interface AttributeSite {
  readonly name: string;
  readonly value: AttributeValue;
  readonly element: ElementSite;
  /** For scope lookups (`path.scope.getBinding`); the parent element is in `element`. */
  readonly path: NodePath<types.JSXAttribute>;
}

export type AttributeValue =
  | { readonly kind: 'bare' }
  | { readonly kind: 'string'; readonly text: string }
  | { readonly kind: 'expression'; readonly expression: types.Expression };

export interface ElementSite {
  /** `button`, `Link`; undefined for a member or namespaced name (`Foo.Bar`, `svg:rect`). */
  readonly name: string | undefined;
  /** The names of all its plain attributes, for rules that depend on a sibling (`a` with `href`). */
  readonly attributes: ReadonlySet<string>;
  readonly node: types.JSXElement;
}

type Replacement = 'empty' | 'remove' | 'false' | 'negate' | 'flip';

/** The part of Stryker's `NodeMutator` (instrumenter `mutators/node-mutator.ts`) that the adapter produces. */
export interface NodeMutatorLike {
  readonly name: string;
  mutate(
    path: NodePath,
    context: { isExpressionContext: boolean },
  ): Iterable<types.Node>;
}

/** Interprets one table row. Attribute rules: parse the site, run `skip`, read the value, build the replacement. */
export function toNodeMutator(
  operator: Operator,
  t: BabelTypes,
): NodeMutatorLike {
  return {
    name: operator.name,
    *mutate(path) {
      for (const rule of operator.rules) {
        if (rule.kind === 'node') {
          yield* rule.mutate(path, t);
          continue;
        }

        const site = attributeSite(path, rule, t);

        if (site === undefined || rule.skip?.(site) === true) {
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

/** Undefined unless `path` is a `JSXAttribute` with a plain name that `rule.attributes` matches and a value `readValue` accepts. */
function attributeSite(
  path: NodePath,
  rule: AttributeRule,
  t: BabelTypes,
): AttributeSite | undefined {
  if (!path.isJSXAttribute() || !t.isJSXIdentifier(path.node.name)) {
    return undefined;
  }

  const name = path.node.name.name;
  const matches =
    rule.attributes instanceof RegExp
      ? rule.attributes.test(name)
      : rule.attributes.includes(name);
  const value = matches ? readValue(path.node.value, t) : undefined;
  const element = elementSite(path, t);

  return value === undefined || element === undefined
    ? undefined
    : { name, value, element, path };
}

/** The element that carries `attribute`: JSXAttribute -> JSXOpeningElement -> JSXElement. */
function elementSite(
  attribute: NodePath<types.JSXAttribute>,
  t: BabelTypes,
): ElementSite | undefined {
  const node = attribute.parentPath.parentPath?.node;

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

/**
 * The only place that decides which values the UI operators leave to the built-ins: bare -> bare; StringLiteral ->
 * string; a container whose expression is a literal (`{true}`, `{'x'}`, `{null}`, a template literal: Babel's
 * `Literal` alias) or a function -> undefined; any other expression -> expression. `JSXEmptyExpression` and a JSX
 * element as the value -> undefined.
 */
function readValue(
  value: types.JSXAttribute['value'],
  t: BabelTypes,
): AttributeValue | undefined {
  if (value === null || value === undefined) {
    return { kind: 'bare' };
  }

  if (t.isStringLiteral(value)) {
    return { kind: 'string', text: value.value };
  }

  if (
    !t.isJSXExpressionContainer(value) ||
    t.isJSXEmptyExpression(value.expression)
  ) {
    return undefined;
  }

  const { expression } = value;

  return t.isLiteral(expression) || t.isFunction(expression)
    ? undefined
    : { kind: 'expression', expression };
}

/**
 * The replacement attribute, or nothing when it would not change the value. The only place that holds the
 * empty-value skip: `empty` on a string whose text is already `""` yields nothing (`alt=""`, `href=""`).
 * empty -> `name=""`; remove -> `name={undefined}`; false -> `name={false}`; negate -> `name={…}` from `negation`;
 * flip -> `name="false"` from `"true"`, else `name="true"`.
 */
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

/**
 * The expression that renders the opposite state, or undefined when the syntax cannot tell one. `!(expr)` alone
 * is wrong for a value that is a string: `!(c ? 'true' : 'false')` and `!String(open)` are always `false`. So a
 * conditional negates each branch and keeps its test; a string branch flips as a string value does; a boolean
 * branch flips; `undefined`, another literal, or a `String()` or `.toString()` call stays as it is (a conditional)
 * or gives no mutant (the whole value); anything else becomes `!(expr)`.
 */
function negation(
  expression: types.Expression,
  t: BabelTypes,
): types.Expression | undefined {
  if (t.isConditionalExpression(expression)) {
    const consequent = negation(expression.consequent, t);
    const alternate = negation(expression.alternate, t);

    return consequent === undefined && alternate === undefined
      ? undefined
      : t.conditionalExpression(
          t.cloneNode(expression.test, true),
          consequent ?? t.cloneNode(expression.consequent, true),
          alternate ?? t.cloneNode(expression.alternate, true),
        );
  }

  if (t.isStringLiteral(expression)) {
    return t.stringLiteral(expression.value === 'true' ? 'false' : 'true');
  }

  if (t.isBooleanLiteral(expression)) {
    return t.booleanLiteral(!expression.value);
  }

  if (
    t.isLiteral(expression) ||
    t.isIdentifier(expression, { name: 'undefined' }) ||
    isStringCall(expression, t)
  ) {
    return undefined;
  }

  return t.unaryExpression('!', t.cloneNode(expression, true));
}

function isStringCall(expression: types.Expression, t: BabelTypes): boolean {
  if (!t.isCallExpression(expression)) {
    return false;
  }

  const { callee } = expression;

  return (
    t.isIdentifier(callee, { name: 'String' }) ||
    (t.isMemberExpression(callee) &&
      t.isIdentifier(callee.property, { name: 'toString' }))
  );
}

/** A node whose parent is a `JSXElement` or `JSXFragment`: a JSX child. Shared by the rules and the placer. */
export function isJsxChild(path: NodePath): boolean {
  return (
    path.parentPath?.isJSXElement() === true ||
    path.parentPath?.isJSXFragment() === true
  );
}
