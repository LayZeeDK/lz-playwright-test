import type { types } from '@babel/core';

import {
  attributeName,
  elementSiteOf,
  isJsxChild,
  mutatorTable,
  type AttributeSite,
  type BabelTypes,
  type ElementSite,
} from './mutator.ts';
import type { RoleTable } from './playwright-roles.ts';
import { notOnSpan, swapsToSpan } from './span-swap.ts';

const hasWord = /[\p{L}\p{N}]/u;
const comparisonOperators: ReadonlySet<string> = new Set([
  '==',
  '!=',
  '===',
  '!==',
  '<',
  '<=',
  '>',
  '>=',
]);
const listMethods: ReadonlySet<string> = new Set(['map', 'filter', 'flatMap']);
// A browser with scripts on, Playwright's default, never renders noscript content.
const unrenderedText: ReadonlySet<string> = new Set([
  'style',
  'script',
  'noscript',
]);
const decorativeElements: ReadonlySet<string> = new Set(['svg', 'img', 'i']);
const labelableElements: ReadonlySet<string> = new Set([
  'input',
  'select',
  'textarea',
]);

export function mutatorsFor(roles: RoleTable) {
  return mutatorTable([
    {
      name: 'LzJsxTextLiteral',
      sample: 'export const a = <p>Hello</p>;\n',
      rules: [
        {
          kind: 'node',
          *mutate(path, t) {
            if (
              path.isJSXText() &&
              hasWord.test(path.node.value) &&
              !isNamed(
                unrenderedText,
                elementSiteOf(path.parentPath.node, t)?.name,
              )
            ) {
              yield t.jsxText('');
            }
          },
        },
      ],
    },
    {
      name: 'LzJsxLabelAttribute',
      sample: 'export const a = <img alt="Logo" />;\n',
      rules: [
        {
          kind: 'attribute',
          attributes: [
            'aria-label',
            'aria-labelledby',
            'alt',
            'title',
            'placeholder',
            'htmlFor',
          ],
          on: { string: 'empty', expression: 'empty' },
          skip: (site, t) =>
            site.name === 'htmlFor' &&
            site.element.name === 'label' &&
            wrapsControl(site.element, t),
        },
      ],
    },
    {
      name: 'LzJsxEventHandler',
      sample: 'export const a = (f: () => void) => <b onClick={f} />;\n',
      rules: [
        {
          kind: 'attribute',
          attributes: /^on[A-Z]/,
          on: { expression: 'remove' },
          skip: isOnlyReferenceOfLocalFunction,
        },
      ],
    },
    {
      name: 'LzJsxConditionalElement',
      sample:
        'export const a = (open: boolean) => <div>{open && <p />}</div>;\n',
      rules: [
        {
          kind: 'node',
          *mutate(path, t) {
            if (
              path.isLogicalExpression({ operator: '&&' }) &&
              path.parentPath.isJSXExpressionContainer() &&
              isJsxBranch(path.node.right, t) &&
              !builtInForces(path.node.left, t)
            ) {
              yield t.cloneNode(path.node.right, true);
            }
          },
        },
        {
          kind: 'node',
          *mutate(path, t) {
            if (
              path.isConditionalExpression() &&
              path.parentPath.isJSXExpressionContainer() &&
              isJsxChild(path.parentPath) &&
              (isJsxBranch(path.node.consequent, t) ||
                isJsxBranch(path.node.alternate, t)) &&
              !builtInForces(path.node.test, t)
            ) {
              yield t.cloneNode(path.node.consequent, true);
              yield t.cloneNode(path.node.alternate, true);
            }
          },
        },
      ],
    },
    {
      name: 'LzJsxUrlAttribute',
      sample: 'export const a = <a href="/about">About</a>;\n',
      rules: [
        {
          kind: 'attribute',
          attributes: ['href', 'to', 'action'],
          on: { string: 'empty', expression: 'empty' },
        },
      ],
    },
    {
      name: 'LzJsxDisabledAttribute',
      sample: 'export const a = <input disabled />;\n',
      rules: [
        {
          kind: 'attribute',
          attributes: ['disabled', 'readOnly', 'aria-disabled'],
          on: { bare: 'remove', string: 'remove', expression: 'false' },
          skip: builtInForcesValue,
        },
      ],
    },
    {
      name: 'LzJsxHiddenAttribute',
      sample: 'export const a = <div hidden />;\n',
      rules: [
        {
          kind: 'attribute',
          attributes: ['hidden', 'aria-hidden'],
          on: { bare: 'remove', string: 'remove', expression: 'false' },
          skip: (site, t) =>
            (site.name === 'aria-hidden' &&
              isNamed(decorativeElements, site.element.name)) ||
            builtInForcesValue(site, t),
        },
      ],
    },
    {
      name: 'LzJsxElementRole',
      sample: 'export const a = <div role="dialog" />;\n',
      rules: [
        {
          kind: 'attribute',
          attributes: ['role'],
          on: { string: 'remove' },
          skip: (site) =>
            site.value.kind === 'string' &&
            implicitRole(site.element, roles) === site.value.text,
        },
        {
          kind: 'node',
          *mutate(path, t) {
            const element = elementSiteOf(path.node, t);

            if (
              element === undefined ||
              !swapsToSpan(implicitRole(element, roles))
            ) {
              return;
            }

            yield asSpan(element, t);
          },
        },
      ],
    },
    {
      name: 'LzJsxChildExpression',
      sample: 'export const a = (n: number) => <p>{n}</p>;\n',
      rules: [
        {
          kind: 'node',
          *mutate(path, t) {
            const container = path.parentPath;

            if (
              container?.isJSXExpressionContainer() &&
              isJsxChild(container) &&
              isRenderedValue(path.node, t)
            ) {
              yield t.nullLiteral();
            }
          },
        },
      ],
    },
    {
      name: 'LzJsxStateAttribute',
      sample:
        'export const a = (open: boolean) => <button aria-expanded={open} />;\n',
      rules: [
        {
          kind: 'attribute',
          attributes: [
            'aria-expanded',
            'aria-pressed',
            'aria-checked',
            'aria-selected',
          ],
          on: { string: 'flip', expression: 'negate' },
          skip: builtInNegates,
        },
      ],
    },
  ]);
}

export type MutatorName = ReturnType<typeof mutatorsFor>[number]['name'];

function isNamed(
  names: ReadonlySet<string>,
  name: string | undefined,
): boolean {
  return name !== undefined && names.has(name);
}

function isJsxBranch(node: types.Node, t: BabelTypes): boolean {
  return t.isJSXElement(node) || t.isJSXFragment(node) || t.isNullLiteral(node);
}

/** A comparison, or `&&`/`||`: built-in ConditionalExpression already makes the same mutants for this test. */
function builtInForces(test: types.Node, t: BabelTypes): boolean {
  return (
    isComparison(test, t) ||
    (t.isLogicalExpression(test) && test.operator !== '??')
  );
}

/** Built-in ConditionalExpression already sets this value to `false`. */
function builtInForcesValue(site: AttributeSite, t: BabelTypes): boolean {
  return (
    site.value.kind === 'expression' && builtInForces(site.value.expression, t)
  );
}

/**
 * Built-in EqualityOperator already negates a comparison, and BooleanLiteral's `x` for a `!x` value renders
 * like `!!x` when `x` is a boolean.
 */
function builtInNegates(site: AttributeSite, t: BabelTypes): boolean {
  if (site.value.kind !== 'expression') {
    return false;
  }

  const value = site.value.expression;

  return (
    isComparison(value, t) ||
    (t.isUnaryExpression(value, { operator: '!' }) &&
      isBooleanBySyntax(value.argument, t))
  );
}

// Babel keeps no node for parentheses, so `!(a === b)` reaches this as the comparison.
function isBooleanBySyntax(node: types.Node, t: BabelTypes): boolean {
  if (t.isLogicalExpression(node) && node.operator !== '??') {
    return isBooleanBySyntax(node.left, t) && isBooleanBySyntax(node.right, t);
  }

  return (
    isComparison(node, t) ||
    t.isBooleanLiteral(node) ||
    t.isUnaryExpression(node, { operator: '!' })
  );
}

function isComparison(node: types.Node, t: BabelTypes): boolean {
  return t.isBinaryExpression(node) && comparisonOperators.has(node.operator);
}

function asSpan(element: ElementSite, t: BabelTypes): types.JSXElement {
  const span = t.cloneNode(element.node, true);
  span.openingElement.name = t.jsxIdentifier('span');
  span.openingElement.attributes = span.openingElement.attributes.filter(
    (attribute) => !isNamed(notOnSpan, attributeName(attribute, t)),
  );

  if (span.closingElement) {
    span.closingElement.name = t.jsxIdentifier('span');
  }

  return span;
}

function implicitRole(
  element: ElementSite,
  roles: RoleTable,
): string | undefined {
  const entry =
    element.name === undefined ? undefined : roles.get(element.name);

  return entry !== undefined &&
    (entry.requiredAttribute === undefined ||
      element.attributes.has(entry.requiredAttribute))
    ? entry.role
    : undefined;
}

/** A `label` whose subtree holds an `input`, `select` or `textarea`: nesting keeps the association without `htmlFor`. */
function wrapsControl(label: ElementSite, t: BabelTypes): boolean {
  const holds = (children: types.JSXElement['children']): boolean =>
    children.some(
      (child) =>
        (t.isJSXElement(child) &&
          (isNamed(labelableElements, elementSiteOf(child, t)?.name) ||
            holds(child.children))) ||
        (t.isJSXFragment(child) && holds(child.children)),
    );

  return holds(label.node.children);
}

function isRenderedValue(node: types.Node, t: BabelTypes): boolean {
  if (t.isCallExpression(node)) {
    const { callee } = node;

    return !(
      t.isMemberExpression(callee) &&
      t.isIdentifier(callee.property) &&
      listMethods.has(callee.property.name)
    );
  }

  return (
    t.isIdentifier(node) ||
    t.isMemberExpression(node) ||
    t.isOptionalMemberExpression(node)
  );
}

/**
 * The handler is an Identifier bound in this file to a function declaration, or to a `const` whose initializer is a
 * function or an arrow, and this attribute is its only reference: built-in BlockStatement already empties it.
 */
function isOnlyReferenceOfLocalFunction(site: AttributeSite): boolean {
  if (
    site.value.kind !== 'expression' ||
    site.value.expression.type !== 'Identifier'
  ) {
    return false;
  }

  const binding = site.path.scope.getBinding(site.value.expression.name);

  if (binding === undefined || binding.references !== 1) {
    return false;
  }

  const declaration = binding.path;

  return (
    declaration.isFunctionDeclaration() ||
    (binding.kind === 'const' &&
      declaration.isVariableDeclarator() &&
      (declaration.node.init?.type === 'ArrowFunctionExpression' ||
        declaration.node.init?.type === 'FunctionExpression'))
  );
}
