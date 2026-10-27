import type { types } from '@babel/core';

import {
  attributeName,
  elementSiteOf,
  isJsxChild,
  operatorTable,
  type AttributeSite,
  type BabelTypes,
  type ElementSite,
} from './mutator.ts';
import { bundled } from './bundled-roles.ts';
import type { RoleTable } from './playwright-roles.ts';

const HAS_WORD = /[\p{L}\p{N}]/u;
const COMPARISON: ReadonlySet<string> = new Set([
  '==',
  '!=',
  '===',
  '!==',
  '<',
  '<=',
  '>',
  '>=',
]);
const LIST_METHODS: ReadonlySet<string> = new Set(['map', 'filter', 'flatMap']);
const UNRENDERED_TEXT: ReadonlySet<string | undefined> = new Set([
  'style',
  'script',
]);
const DECORATIVE: ReadonlySet<string | undefined> = new Set([
  'svg',
  'img',
  'i',
]);
const LABELABLE: ReadonlySet<string | undefined> = new Set([
  'input',
  'select',
  'textarea',
]);
/** A span cannot take these under @types/react 19.3.0 (TS2322); a span ignores them at run time. */
const NOT_ON_SPAN: ReadonlySet<string | undefined> = new Set([
  'href',
  'type',
  'disabled',
]);
/** The operators, with LzElementRole reading each element's implicit role from `roles`. */
export function operatorsFor(roles: RoleTable) {
  return operatorTable([
    {
      name: 'LzTextLiteral',
      sample: 'export const a = <p>Hello</p>;\n',
      rules: [
        {
          kind: 'node',
          *mutate(path, t) {
            if (
              path.isJSXText() &&
              HAS_WORD.test(path.node.value) &&
              !UNRENDERED_TEXT.has(elementSiteOf(path.parentPath.node, t)?.name)
            ) {
              yield t.jsxText('');
            }
          },
        },
      ],
    },
    {
      name: 'LzLabelAttribute',
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
      name: 'LzEventHandler',
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
      name: 'LzConditionalElement',
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
      name: 'LzUrlAttribute',
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
      name: 'LzDisabledAttribute',
      sample: 'export const a = <input disabled />;\n',
      rules: [
        {
          kind: 'attribute',
          attributes: ['disabled', 'readOnly', 'aria-disabled'],
          on: { bare: 'remove', string: 'remove', expression: 'false' },
        },
      ],
    },
    {
      name: 'LzHiddenAttribute',
      sample: 'export const a = <div hidden />;\n',
      rules: [
        {
          kind: 'attribute',
          attributes: ['hidden', 'aria-hidden'],
          on: { bare: 'remove', string: 'remove', expression: 'false' },
          skip: (site) =>
            site.name === 'aria-hidden' && DECORATIVE.has(site.element.name),
        },
      ],
    },
    {
      name: 'LzElementRole',
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

            if (element === undefined || !swapsToSpan(element, roles)) {
              return;
            }

            yield asSpan(element, t);
          },
        },
      ],
    },
    {
      name: 'LzChildExpression',
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
      name: 'LzStateAttribute',
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
        },
      ],
    },
  ]);
}

export type OperatorName = ReturnType<typeof operatorsFor>[number]['name'];

export const operatorNames: readonly OperatorName[] = operatorsFor(
  bundled.roles,
).map(({ name }) => name);

function isJsxBranch(node: types.Node, t: BabelTypes): boolean {
  return t.isJSXElement(node) || t.isJSXFragment(node) || t.isNullLiteral(node);
}

/** A comparison, or `&&`/`||`: built-in ConditionalExpression already makes the same mutants for this test. */
function builtInForces(test: types.Node, t: BabelTypes): boolean {
  return (
    (t.isBinaryExpression(test) && COMPARISON.has(test.operator)) ||
    (t.isLogicalExpression(test) && test.operator !== '??')
  );
}

function swapsToSpan(element: ElementSite, roles: RoleTable): boolean {
  const role = implicitRole(element, roles);

  return role === 'button' || role === 'link';
}

function asSpan(element: ElementSite, t: BabelTypes): types.JSXElement {
  const span = t.cloneNode(element.node, true);
  span.openingElement.name = t.jsxIdentifier('span');
  span.openingElement.attributes = span.openingElement.attributes.filter(
    (attribute) => !NOT_ON_SPAN.has(attributeName(attribute, t)),
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
  const entry = roles.get(element.name);

  return entry !== undefined &&
    (entry.attribute === undefined || element.attributes.has(entry.attribute))
    ? entry.role
    : undefined;
}

/** A `label` whose subtree holds an `input`, `select` or `textarea`: nesting keeps the association without `htmlFor`. */
function wrapsControl(label: ElementSite, t: BabelTypes): boolean {
  const holds = (children: types.JSXElement['children']): boolean =>
    children.some(
      (child) =>
        (t.isJSXElement(child) &&
          (LABELABLE.has(elementSiteOf(child, t)?.name) ||
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
      LIST_METHODS.has(callee.property.name)
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
