// The operator table: one row per operator, in the design's rank order. Every skip the design names lives in
// exactly one row (or, for the value kinds and the empty value, in mutator.ts's readValue and replaced).
import type { NodePath, types } from '@babel/core';

import {
  isJsxChild,
  operatorTable,
  type AttributeSite,
  type BabelTypes,
  type ElementSite,
} from './mutator.ts';

const HAS_WORD = /[\p{L}\p{N}]/u;
/** Built-in ConditionalExpression already forces `true`/`false` on a test of these shapes. */
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
/** Calls that render a list; the later ListExpression owns them. */
const LIST_METHODS: ReadonlySet<string> = new Set(['map', 'filter', 'flatMap']);
/** Their text is CSS or code, not rendered text. */
const UNRENDERED_TEXT: ReadonlySet<string> = new Set(['style', 'script']);
/** Decorative icons: exposing them is unobservable to role, label and text queries. */
const DECORATIVE: ReadonlySet<string> = new Set(['svg', 'img', 'i']);
const LABELABLE: ReadonlySet<string> = new Set(['input', 'select', 'textarea']);
/** A span cannot take these under @types/react 19.3.0 (TS2322); a span ignores them at run time. */
const NOT_ON_SPAN: ReadonlySet<string> = new Set(['href', 'type', 'disabled']);
/**
 * The roles Playwright 1.64.1's `getByRole` gives a tag in any context (`getImplicitAriaRole` in
 * playwright-core/lib/coreBundle.js); an explicit equal `role` restates them. `a` is `link` only with `href`.
 * `area`, `footer`, `form`, `header`, `img`, `input`, `section`, `select`, `td` and `th` get their role from
 * attributes or context, so they are left out. `dd`, `dt`, `li`, `tbody`, `tfoot`, `thead` and `tr` lose their role
 * under a parent with `role="none"` or `role="presentation"`; that shape is rare, so they stay in.
 */
const IMPLICIT_ROLE: ReadonlyMap<string, string> = new Map([
  ['article', 'article'],
  ['aside', 'complementary'],
  ['blockquote', 'blockquote'],
  ['button', 'button'],
  ['caption', 'caption'],
  ['code', 'code'],
  ['datalist', 'listbox'],
  ['dd', 'definition'],
  ['del', 'deletion'],
  ['details', 'group'],
  ['dfn', 'term'],
  ['dialog', 'dialog'],
  ['dt', 'term'],
  ['em', 'emphasis'],
  ['fieldset', 'group'],
  ['figure', 'figure'],
  ['h1', 'heading'],
  ['h2', 'heading'],
  ['h3', 'heading'],
  ['h4', 'heading'],
  ['h5', 'heading'],
  ['h6', 'heading'],
  ['hr', 'separator'],
  ['html', 'document'],
  ['ins', 'insertion'],
  ['li', 'listitem'],
  ['main', 'main'],
  ['mark', 'mark'],
  ['math', 'math'],
  ['menu', 'list'],
  ['meter', 'meter'],
  ['nav', 'navigation'],
  ['ol', 'list'],
  ['optgroup', 'group'],
  ['option', 'option'],
  ['output', 'status'],
  ['p', 'paragraph'],
  ['progress', 'progressbar'],
  ['search', 'search'],
  ['strong', 'strong'],
  ['sub', 'subscript'],
  ['sup', 'superscript'],
  ['svg', 'img'],
  ['table', 'table'],
  ['tbody', 'rowgroup'],
  ['textarea', 'textbox'],
  ['tfoot', 'rowgroup'],
  ['thead', 'rowgroup'],
  ['time', 'time'],
  ['tr', 'row'],
  ['ul', 'list'],
]);

export const operators = operatorTable([
  {
    name: 'TextLiteral',
    sample: 'export const a = <p>Hello</p>;\n',
    rules: [
      {
        kind: 'node',
        *mutate(path, t) {
          if (
            path.isJSXText() &&
            HAS_WORD.test(path.node.value) &&
            // Stryker disable next-line StringLiteral: equivalent, as UNRENDERED_TEXT has no key '' and no key 'Stryker was here!'
            !UNRENDERED_TEXT.has(elementName(path.parentPath, t) ?? '')
          ) {
            yield t.jsxText('');
          }
        },
      },
    ],
  },
  {
    name: 'LabelAttribute',
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
        skip: (site) =>
          site.name === 'htmlFor' &&
          site.element.name === 'label' &&
          wrapsControl(site.element),
      },
    ],
  },
  {
    name: 'EventHandler',
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
    name: 'ConditionalElement',
    sample: 'export const a = (open: boolean) => <div>{open && <p />}</div>;\n',
    rules: [
      {
        kind: 'node',
        *mutate(path, t) {
          // ConditionalGuardRemoval: `x && <A/>` becomes `<A/>`.
          if (
            path.isLogicalExpression({ operator: '&&' }) &&
            path.parentPath.isJSXExpressionContainer() &&
            isJsxBranch(path.node.right, t) &&
            !builtInForces(path.node.left, t)
          ) {
            yield t.cloneNode(path.node.right, true);
          }

          // ConditionalToConsequent and ConditionalToAlternate, for a ternary rendered as a JSX child only.
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
    name: 'UrlAttribute',
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
    name: 'DisabledAttribute',
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
    name: 'HiddenAttribute',
    sample: 'export const a = <div hidden />;\n',
    rules: [
      {
        kind: 'attribute',
        attributes: ['hidden', 'aria-hidden'],
        on: { bare: 'remove', string: 'remove', expression: 'false' },
        skip: (site) =>
          site.name === 'aria-hidden' &&
          // Stryker disable next-line StringLiteral: equivalent, as DECORATIVE has no key '' and no key 'Stryker was here!'
          DECORATIVE.has(site.element.name ?? ''),
      },
    ],
  },
  {
    name: 'ElementRole',
    sample: 'export const a = <div role="dialog" />;\n',
    rules: [
      {
        // RoleRemoval: `role="dialog"` becomes `role={undefined}`.
        kind: 'attribute',
        attributes: ['role'],
        on: { string: 'remove' },
        skip: (site) =>
          site.value.kind === 'string' &&
          implicitRole(site.element) === site.value.text,
      },
      {
        // ElementToSpan: `button` always; `a` only with `href`, as an `a` without one has no link role.
        kind: 'node',
        *mutate(path, t) {
          if (!path.isJSXElement() || !swapsToSpan(path.node, t)) {
            return;
          }

          const span = t.cloneNode(path.node, true);
          span.openingElement.name = t.jsxIdentifier('span');
          span.openingElement.attributes =
            span.openingElement.attributes.filter(
              (attribute) =>
                !(
                  t.isJSXAttribute(attribute) &&
                  t.isJSXIdentifier(attribute.name) &&
                  NOT_ON_SPAN.has(attribute.name.name)
                ),
            );

          if (span.closingElement) {
            span.closingElement.name = t.jsxIdentifier('span');
          }

          yield span;
        },
      },
    ],
  },
  {
    name: 'ChildExpression',
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
    name: 'StateAttribute',
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

/** Derived from the table; the cases harness types its expectations with it, so no second list of names exists. */
export type OperatorName = (typeof operators)[number]['name'];

export const operatorNames: readonly OperatorName[] = operators.map(
  ({ name }) => name,
);

function elementName(path: NodePath | null, t: BabelTypes): string | undefined {
  return path?.isJSXElement() &&
    t.isJSXIdentifier(path.node.openingElement.name)
    ? path.node.openingElement.name.name
    : undefined;
}

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

function swapsToSpan(element: types.JSXElement, t: BabelTypes): boolean {
  const { name, attributes } = element.openingElement;

  if (!t.isJSXIdentifier(name)) {
    return false;
  }

  return (
    name.name === 'button' ||
    (name.name === 'a' &&
      attributes.some(
        (attribute) =>
          t.isJSXAttribute(attribute) &&
          t.isJSXIdentifier(attribute.name, { name: 'href' }),
      ))
  );
}

function implicitRole(element: ElementSite): string | undefined {
  if (element.name === 'a') {
    return element.attributes.has('href') ? 'link' : undefined;
  }

  // Stryker disable next-line StringLiteral: equivalent, as IMPLICIT_ROLE has no key '' and no key 'Stryker was here!'
  return IMPLICIT_ROLE.get(element.name ?? '');
}

/** A `label` whose subtree holds an `input`, `select` or `textarea`: nesting keeps the association without `htmlFor`. */
function wrapsControl(label: ElementSite): boolean {
  const holds = (children: types.JSXElement['children']): boolean =>
    children.some(
      (child) =>
        (child.type === 'JSXElement' &&
          ((child.openingElement.name.type === 'JSXIdentifier' &&
            LABELABLE.has(child.openingElement.name.name)) ||
            holds(child.children))) ||
        (child.type === 'JSXFragment' && holds(child.children)),
    );

  return holds(label.node.children);
}

/** An identifier, member access, optional member access or call, except a list-rendering call. */
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
