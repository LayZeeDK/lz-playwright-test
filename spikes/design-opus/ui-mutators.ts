// Prototype of @spr/stryker-ui-mutators for the design spike. Erasable TypeScript only.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { NodePath, types as T } from '@babel/core';

export type Replacement = 'emptyString' | 'remove' | 'false' | 'negate';

export interface AttributeRule {
  readonly kind: 'attribute';
  readonly attributes: readonly string[] | RegExp;
  readonly onString?: readonly Replacement[];
  readonly onBare?: readonly Replacement[];
  readonly onExpression?: readonly Replacement[];
}

export interface NodeRule {
  readonly kind: 'node';
  mutate(path: NodePath, t: typeof T): Iterable<T.Node>;
}

export type Rule = AttributeRule | NodeRule;

export interface UiOperator {
  readonly name: string;
  readonly rank: number;
  readonly rules: readonly Rule[];
}

const HAS_WORD = /[\p{L}\p{N}]/u;
const INTERACTIVE_TAGS = new Set(['button', 'a']);
const RENDER_METHODS = new Set(['map', 'filter', 'flatMap']);

function isJsxChild(path: NodePath): boolean {
  return path.parentPath?.isJSXElement() === true || path.parentPath?.isJSXFragment() === true;
}

function isJsxBranch(node: T.Node, t: typeof T): boolean {
  return t.isJSXElement(node) || t.isJSXFragment(node) || t.isNullLiteral(node);
}

export const operators: readonly UiOperator[] = [
  {
    name: 'TextContent',
    rank: 1,
    rules: [
      {
        kind: 'node',
        *mutate(path, t) {
          if (path.isJSXText() && isJsxChild(path) && HAS_WORD.test(path.node.value)) {
            yield t.jsxText('');
          }
        },
      },
    ],
  },
  {
    name: 'AccessibleName',
    rank: 2,
    rules: [
      {
        kind: 'attribute',
        attributes: ['aria-label', 'aria-labelledby', 'alt', 'title', 'placeholder', 'htmlFor'],
        onString: ['emptyString'],
        onExpression: ['emptyString'],
      },
    ],
  },
  {
    name: 'EventHandler',
    rank: 3,
    rules: [{ kind: 'attribute', attributes: /^on[A-Z]/, onExpression: ['remove'] }],
  },
  {
    name: 'ConditionalRendering',
    rank: 4,
    rules: [
      {
        kind: 'node',
        *mutate(path, t) {
          if (
            path.isLogicalExpression({ operator: '&&' }) &&
            path.parentPath.isJSXExpressionContainer() &&
            isJsxBranch(path.node.right, t)
          ) {
            yield t.cloneNode(path.node.right, true);
          }

          if (
            path.isConditionalExpression() &&
            (isJsxBranch(path.node.consequent, t) || isJsxBranch(path.node.alternate, t))
          ) {
            yield t.cloneNode(path.node.consequent, true);
            yield t.cloneNode(path.node.alternate, true);
          }
        },
      },
    ],
  },
  {
    name: 'NavigationTarget',
    rank: 5,
    rules: [
      {
        kind: 'attribute',
        attributes: ['href', 'to', 'action', 'formAction'],
        onString: ['emptyString'],
        onExpression: ['emptyString'],
      },
    ],
  },
  {
    name: 'DisabledState',
    rank: 6,
    rules: [
      {
        kind: 'attribute',
        attributes: ['disabled', 'aria-disabled', 'readOnly'],
        onBare: ['remove'],
        onString: ['remove'],
        onExpression: ['false'],
      },
    ],
  },
  {
    name: 'HiddenState',
    rank: 7,
    rules: [
      {
        kind: 'attribute',
        attributes: ['hidden', 'aria-hidden', 'inert'],
        onBare: ['remove'],
        onString: ['remove'],
        onExpression: ['false'],
      },
    ],
  },
  {
    name: 'Role',
    rank: 8,
    rules: [
      { kind: 'attribute', attributes: ['role'], onString: ['remove'] },
      {
        kind: 'node',
        *mutate(path, t) {
          if (!path.isJSXElement()) {
            return;
          }

          const name = path.node.openingElement.name;

          if (!t.isJSXIdentifier(name) || !INTERACTIVE_TAGS.has(name.name)) {
            return;
          }

          const clone = t.cloneNode(path.node, true);
          clone.openingElement.name = t.jsxIdentifier('span');

          if (clone.closingElement) {
            clone.closingElement.name = t.jsxIdentifier('span');
          }

          yield clone;
        },
      },
    ],
  },
  {
    name: 'ChildExpression',
    rank: 9,
    rules: [
      {
        kind: 'node',
        *mutate(path, t) {
          if (!path.parentPath?.isJSXExpressionContainer() || !isJsxChild(path.parentPath)) {
            return;
          }

          const node = path.node;
          const isRenderCall =
            t.isCallExpression(node) &&
            t.isMemberExpression(node.callee) &&
            t.isIdentifier(node.callee.property) &&
            RENDER_METHODS.has(node.callee.property.name);

          if (
            (t.isIdentifier(node) || t.isMemberExpression(node) || t.isOptionalMemberExpression(node) || t.isCallExpression(node)) &&
            !isRenderCall
          ) {
            yield t.nullLiteral();
          }
        },
      },
    ],
  },
  {
    name: 'AriaState',
    rank: 10,
    rules: [
      {
        kind: 'attribute',
        attributes: ['aria-expanded', 'aria-pressed', 'aria-checked', 'aria-selected', 'aria-current', 'aria-invalid', 'checked'],
        onString: ['remove'],
        onExpression: ['negate'],
      },
    ],
  },
];

type ValueKind = 'string' | 'bare' | 'expression';

// Literal values are mutated by StringLiteral/BooleanLiteral, function values by ArrowFunction/BlockStatement.
function classifyValue(value: T.JSXAttribute['value'], t: typeof T): ValueKind | undefined {
  if (value === null || value === undefined) {
    return 'bare';
  }

  if (t.isStringLiteral(value)) {
    return 'string';
  }

  if (!t.isJSXExpressionContainer(value) || t.isJSXEmptyExpression(value.expression)) {
    return undefined;
  }

  const e = value.expression;

  if (t.isLiteral(e) || t.isFunction(e)) {
    return undefined;
  }

  return 'expression';
}

function attributeMatches(rule: AttributeRule, name: string): boolean {
  return rule.attributes instanceof RegExp ? rule.attributes.test(name) : rule.attributes.includes(name);
}

const replacementsByKind = { string: 'onString', bare: 'onBare', expression: 'onExpression' } as const;

function buildAttribute(attr: T.JSXAttribute, replacement: Replacement, t: typeof T): T.JSXAttribute {
  const name = t.cloneNode(attr.name);
  const container = (e: T.Expression) => t.jsxAttribute(name, t.jsxExpressionContainer(e));
  const table: Record<Replacement, () => T.JSXAttribute> = {
    emptyString: () => t.jsxAttribute(name, t.stringLiteral('')),
    remove: () => container(t.identifier('undefined')),
    false: () => container(t.booleanLiteral(false)),
    negate: () => container(t.unaryExpression('!', t.cloneNode((attr.value as T.JSXExpressionContainer).expression as T.Expression, true))),
  };

  return table[replacement]();
}

function toNodeMutator(op: UiOperator, t: typeof T) {
  return {
    name: op.name,
    *mutate(path: NodePath): Iterable<T.Node> {
      for (const rule of op.rules) {
        if (rule.kind === 'node') {
          yield* rule.mutate(path, t);
          continue;
        }

        if (!path.isJSXAttribute() || !t.isJSXIdentifier(path.node.name) || !attributeMatches(rule, path.node.name.name)) {
          continue;
        }

        const kind = classifyValue(path.node.value, t);

        for (const replacement of kind ? (rule[replacementsByKind[kind]] ?? []) : []) {
          yield buildAttribute(path.node, replacement, t);
        }
      }
    },
  };
}

function attributeValueExpression(value: T.JSXAttribute['value'], t: typeof T): T.Expression {
  if (value === null || value === undefined) {
    return t.booleanLiteral(true);
  }

  if (t.isStringLiteral(value)) {
    // A fresh literal drops `extra.raw`, which holds undecoded JSX entities such as `&amp;`.
    // Negative control for the spike: SPIKE_KEEP_RAW=1 reuses the parsed literal as-is.
    return process.env.SPIKE_KEEP_RAW ? value : t.stringLiteral(value.value);
  }

  return (value as T.JSXExpressionContainer).expression as T.Expression;
}

// Same whitespace cleanup the JSX transform applies; empty text compiles to no child, so use `null`.
function jsxTextAsString(node: T.JSXText, t: typeof T): T.Expression {
  const element = t.jsxElement(t.jsxOpeningElement(t.jsxIdentifier('x'), []), t.jsxClosingElement(t.jsxIdentifier('x')), [node]);
  const [child] = t.react.buildChildren(element);

  return t.isStringLiteral(child) ? t.stringLiteral(child.value) : t.nullLiteral();
}

interface Placer {
  name: string;
  canPlace(path: NodePath): boolean;
  place(path: NodePath, appliedMutants: Map<unknown, T.Node>): void;
}

function patchPlacer(placer: Placer, t: typeof T): void {
  const canPlace = placer.canPlace.bind(placer);
  const place = placer.place.bind(placer);
  const remap = (applied: Map<unknown, T.Node>, f: (n: T.Node) => T.Expression) =>
    new Map([...applied].map(([mutant, node]) => [mutant, f(node)] as const));

  placer.canPlace = (path) =>
    canPlace(path) || path.isJSXAttribute() || (path.isJSXText() && isJsxChild(path) && HAS_WORD.test(path.node.value));

  placer.place = (path, applied) => {
    if (path.isJSXAttribute()) {
      path.node.value = t.jsxExpressionContainer(attributeValueExpression(path.node.value, t));
      place(path.get('value.expression') as NodePath, remap(applied, (n) => attributeValueExpression((n as T.JSXAttribute).value, t)));

      return;
    }

    if (path.isJSXText()) {
      const [container] = path.replaceWith(t.jsxExpressionContainer(jsxTextAsString(path.node, t)));
      place(container.get('expression') as NodePath, remap(applied, (n) => jsxTextAsString(n as T.JSXText, t)));

      return;
    }

    if (isJsxChild(path)) {
      const [container] = path.replaceWith(t.jsxExpressionContainer(path.node as T.Expression));
      place(container.get('expression') as NodePath, applied as Map<unknown, T.Expression>);

      return;
    }

    place(path, applied);
  };
}

export const SUPPORTED_INSTRUMENTER = '10.1.1';

// Resolve the instrumenter that @stryker-mutator/core itself imports, so a second copy elsewhere is never patched.
export function instrumenterDir(fromDir: string): string {
  const requireFromProject = createRequire(join(fromDir, 'package.json'));
  const coreDir = dirname(requireFromProject.resolve('@stryker-mutator/core/package.json'));

  return dirname(createRequire(join(coreDir, 'package.json')).resolve('@stryker-mutator/instrumenter/package.json'));
}

export async function install(fromDir: string): Promise<{ added: string[]; dir: string }> {
  const dir = instrumenterDir(fromDir);
  const { version } = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { version: string };

  if (version !== SUPPORTED_INSTRUMENTER) {
    throw new Error(`stryker-ui-mutators supports @stryker-mutator/instrumenter ${SUPPORTED_INSTRUMENTER}, found ${version} in ${dir}`);
  }

  const load = (rel: string) => import(pathToFileURL(join(dir, rel)).href);
  const { allMutators } = (await load('dist/src/mutators/mutate.js')) as { allMutators: { name: string }[] };
  const { allMutantPlacers } = (await load('dist/src/mutant-placers/index.js')) as { allMutantPlacers: Placer[] };
  const t = (createRequire(join(dir, 'package.json'))('@babel/core') as { types: typeof T }).types;
  const known = new Set(allMutators.map((m) => m.name));
  const added = operators.filter((op) => !known.has(op.name));

  if (added.length === operators.length) {
    patchPlacer(allMutantPlacers.find((p) => p.name === 'expressionMutantPlacer')!, t);
  }

  allMutators.push(...added.map((op) => toNodeMutator(op, t)));

  return { added: added.map((op) => op.name), dir };
}
