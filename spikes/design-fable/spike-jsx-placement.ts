// Spike for docs/design/playwright-mutators-fable.md section 5.
// Claim under test: UI operators that mutate at JSXAttribute and JSXText nodes can be placed by
// wrapping the installed instrumenter's expression placer (attribute -> {...spread}, text -> {expr}),
// the output compiles, and every mutant changes what React renders (or the handler props) when
// activated through globalThis.__stryker__.activeMutant, while the baseline render stays identical.
// Run: node spikes/design-fable/spike-jsx-placement.ts   (Node 24 type stripping, no installs)
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { NodePath, types as T } from '@babel/core';

const here = dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const repoRequire = createRequire(join(here, '..', '..', 'package.json'));

// Resolve the instrumenter the way core would see it: from @stryker-mutator/core's own location.
const coreRequire = createRequire(repoRequire.resolve('@stryker-mutator/core/package.json'));
const pkgDir = dirname(coreRequire.resolve('@stryker-mutator/instrumenter/package.json'));
const dist = (p: string) => pathToFileURL(join(pkgDir, 'dist/src', p)).href;

const { allMutators } = await import(dist('mutators/mutate.js'));
const { allMutantPlacers } = await import(dist('mutant-placers/index.js'));
const { mutantTestExpression, mutationCoverageSequenceExpression } = await import(dist('util/syntax-helpers.js'));
const { Instrumenter } = await import(dist('index.js'));
const instrumenterRequire = createRequire(join(pkgDir, 'package.json'));
const babel = instrumenterRequire('@babel/core');
const t: typeof T = babel.types;

// ---------- placement: the plugin-side wrap of expressionMutantPlacer ----------

const SKIP_ATTRIBUTES = new Set(['key', 'ref', 'children', 'dangerouslySetInnerHTML']);

function isPlainAttribute(path: NodePath): path is NodePath<T.JSXAttribute> {
  return path.isJSXAttribute() && t.isJSXIdentifier(path.node.name) && !SKIP_ATTRIBUTES.has(path.node.name.name);
}

function isMeaningfulText(path: NodePath): path is NodePath<T.JSXText> {
  return path.isJSXText() && /[\p{L}\p{N}]/u.test(path.node.value);
}

function attributeToObject(attr: T.JSXAttribute): T.ObjectExpression {
  const name = (attr.name as T.JSXIdentifier).name;
  const key = /^[A-Za-z_$][\w$]*$/.test(name) ? t.identifier(name) : t.stringLiteral(name);
  let value: T.Expression;

  if (attr.value === null || attr.value === undefined) {
    value = t.booleanLiteral(true);
  } else if (t.isJSXExpressionContainer(attr.value)) {
    value = attr.value.expression as T.Expression;
  } else {
    value = attr.value as T.Expression;
  }

  return t.objectExpression([t.objectProperty(key, value)]);
}

function cleanText(value: string): T.Expression {
  const el = t.jsxElement(t.jsxOpeningElement(t.jsxIdentifier('x'), []), t.jsxClosingElement(t.jsxIdentifier('x')), [t.jsxText(value)]);
  const build = (t as any).react?.buildChildren ?? (t as any).buildChildren;
  const [child] = build(el) as T.Expression[];

  return child ?? t.stringLiteral('');
}

function chain(appliedMutants: Map<{ id: string }, T.Node>, original: T.Expression, toExpression: (n: T.Node) => T.Expression): T.Expression {
  let expression = mutationCoverageSequenceExpression(appliedMutants.keys(), original);

  for (const [mutant, applied] of appliedMutants) {
    expression = t.conditionalExpression(mutantTestExpression(mutant.id), toExpression(applied), expression);
  }

  return expression;
}

const expressionPlacer = allMutantPlacers.find((p: { name: string }) => p.name === 'expressionMutantPlacer');
const originalCanPlace = expressionPlacer.canPlace;
const originalPlace = expressionPlacer.place;

expressionPlacer.canPlace = function (path: NodePath) {
  return isPlainAttribute(path) || isMeaningfulText(path) || originalCanPlace.call(this, path);
};

expressionPlacer.place = function (path: NodePath, appliedMutants: Map<{ id: string }, T.Node>) {
  if (isPlainAttribute(path)) {
    const expression = chain(appliedMutants, attributeToObject(path.node), (n) => attributeToObject(n as T.JSXAttribute));
    path.replaceWith(t.jsxSpreadAttribute(expression));

    return;
  }

  if (isMeaningfulText(path)) {
    const expression = chain(appliedMutants, cleanText(path.node.value), (n) => n as T.Expression);
    path.replaceWith(t.jsxExpressionContainer(expression));

    return;
  }

  originalPlace.call(this, path, appliedMutants);
};

// ---------- operators (spike-sized versions of the catalog in section 2) ----------

function attrName(path: NodePath<T.JSXAttribute>): string {
  return (path.node.name as T.JSXIdentifier).name;
}

function attrWithValue(path: NodePath<T.JSXAttribute>, value: T.JSXAttribute['value']): T.JSXAttribute {
  return t.jsxAttribute(t.cloneNode(path.node.name), value);
}

function attrWithExpression(path: NodePath<T.JSXAttribute>, expression: T.Expression): T.JSXAttribute {
  return attrWithValue(path, t.jsxExpressionContainer(expression));
}

function hasStringValue(path: NodePath<T.JSXAttribute>): string | undefined {
  const v = path.node.value;

  if (t.isStringLiteral(v)) {
    return v.value;
  }

  if (t.isJSXExpressionContainer(v) && t.isStringLiteral(v.expression)) {
    return v.expression.value;
  }

  return undefined;
}

function* flipBooleanish(path: NodePath<T.JSXAttribute>): Iterable<T.Node> {
  const v = path.node.value;

  if (v === null || v === undefined) {
    yield attrWithExpression(path, t.booleanLiteral(false));
  } else if (t.isStringLiteral(v) && (v.value === 'true' || v.value === 'false')) {
    yield attrWithValue(path, t.stringLiteral(v.value === 'true' ? 'false' : 'true'));
  } else if (
    t.isJSXExpressionContainer(v) &&
    !t.isBooleanLiteral(v.expression) &&
    !t.isJSXEmptyExpression(v.expression) &&
    !t.isUnaryExpression(v.expression, { operator: '!' })
  ) {
    // Boolean literals and a leading `!` are already flipped by the built-in BooleanLiteral mutator.
    yield attrWithExpression(path, t.unaryExpression('!', t.cloneNode(v.expression as T.Expression, true)));
  }
}

const booleanOperators = new Set(['!=', '!==', '&&', '<', '<=', '==', '===', '>', '>=', '||']);

function builtInForcesTrue(node: T.Node): boolean {
  return (t.isBinaryExpression(node) || t.isLogicalExpression(node)) && booleanOperators.has(node.operator);
}

function isJsx(node: T.Node | null | undefined): boolean {
  return t.isJSXElement(node) || t.isJSXFragment(node);
}

const attributeOperators: Array<{ name: string; attributes: Set<string>; mutate(path: NodePath<T.JSXAttribute>): Iterable<T.Node> }> = [
  {
    name: 'JsxEventHandlerRemoval',
    attributes: new Set(),
    *mutate(path) {
      if (/^on[A-Z]/.test(attrName(path))) {
        yield attrWithExpression(path, t.identifier('undefined'));
      }
    },
  },
  {
    name: 'JsxAccessibleNameEmpty',
    attributes: new Set(['aria-label', 'alt', 'placeholder', 'aria-labelledby', 'htmlFor']),
    *mutate(path) {
      if (this.attributes.has(attrName(path)) && hasStringValue(path) !== '' && path.node.value) {
        yield attrWithValue(path, t.stringLiteral(''));
      }
    },
  },
  {
    name: 'JsxDisabledFlip',
    attributes: new Set(['disabled', 'readOnly', 'aria-disabled']),
    *mutate(path) {
      if (this.attributes.has(attrName(path))) {
        yield* flipBooleanish(path);
      }
    },
  },
  {
    name: 'JsxHiddenFlip',
    attributes: new Set(['hidden', 'aria-hidden', 'inert']),
    *mutate(path) {
      if (this.attributes.has(attrName(path))) {
        yield* flipBooleanish(path);
      }
    },
  },
  {
    name: 'JsxRoleRemoval',
    attributes: new Set(['role']),
    *mutate(path) {
      const value = hasStringValue(path);

      if (attrName(path) === 'role' && value && value !== 'presentation' && value !== 'none') {
        yield attrWithExpression(path, t.identifier('undefined'));
      }
    },
  },
  {
    name: 'JsxNavigationTarget',
    attributes: new Set(['href', 'to']),
    *mutate(path) {
      const value = hasStringValue(path);

      if (this.attributes.has(attrName(path)) && value !== undefined && value !== '#') {
        yield attrWithValue(path, t.stringLiteral('#'));
      }
    },
  },
  {
    name: 'JsxButtonTypeSwap',
    attributes: new Set(['type']),
    *mutate(path) {
      const value = hasStringValue(path);
      const swap: Record<string, string> = { submit: 'button', button: 'submit', reset: 'button' };

      if (attrName(path) === 'type' && value && swap[value]) {
        yield attrWithValue(path, t.stringLiteral(swap[value]));
      }
    },
  },
];

const uiMutators = [
  ...attributeOperators.map((op) => ({
    name: op.name,
    *mutate(path: NodePath) {
      if (isPlainAttribute(path)) {
        yield* op.mutate(path);
      }
    },
  })),
  {
    name: 'JsxTextEmpty',
    *mutate(path: NodePath) {
      if (isMeaningfulText(path)) {
        yield t.stringLiteral('');
      }
    },
  },
  {
    name: 'JsxConditionalRender',
    *mutate(path: NodePath) {
      if (path.isLogicalExpression() && path.node.operator === '&&' && isJsx(path.node.right) && !builtInForcesTrue(path.node.left)) {
        yield t.cloneNode(path.node.right, true);
      }

      if (path.isConditionalExpression() && (isJsx(path.node.consequent) || isJsx(path.node.alternate)) && !builtInForcesTrue(path.node.test)) {
        yield t.cloneNode(path.node.consequent, true);
        yield t.cloneNode(path.node.alternate, true);
      }
    },
  },
  {
    name: 'JsxListTruncate',
    *mutate(path: NodePath) {
      if (
        path.isCallExpression() &&
        path.parentPath.isJSXExpressionContainer() &&
        t.isMemberExpression(path.node.callee) &&
        t.isIdentifier(path.node.callee.property, { name: 'map' }) &&
        path.node.arguments.length > 0
      ) {
        const callee = path.node.callee;
        const sliced = t.callExpression(t.memberExpression(t.cloneNode(callee.object, true), t.identifier('slice')), [
          t.numericLiteral(0),
          t.numericLiteral(1),
        ]);
        yield t.callExpression(t.memberExpression(sliced, t.identifier('map')), path.node.arguments.map((a) => t.cloneNode(a, true)));
      }
    },
  },
];

allMutators.push(...uiMutators);

// ---------- instrument ----------

const fileName = join(here, 'Dialog.tsx');
const source = readFileSync(fileName, 'utf8');
const logger = { isDebugEnabled: () => false, debug() {}, info() {}, warn: console.error, error: console.error };
const result = await new Instrumenter(logger).instrument([{ name: fileName, content: source, mutate: true }], {
  plugins: null,
  excludedMutations: [],
  ignorers: [],
});
const uiNames = new Set(uiMutators.map((m) => m.name));
const custom = result.mutants.filter((m: { mutatorName: string }) => uiNames.has(m.mutatorName));
const instrumented: string = result.files[0].content;
const outDir = join(here, 'out');
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'Dialog.instrumented.tsx'), instrumented);

console.log(`mutants: ${result.mutants.length} total, ${custom.length} from UI operators`);

for (const m of custom) {
  console.log(`  L${m.location.start.line + 1} ${m.mutatorName} -> ${m.replacement.replace(/\s+/g, ' ')}`);
}

console.log(`instrumented size ${instrumented.length} chars (original ${source.length}); contains JSXSpreadAttribute placement: ${instrumented.includes('{...stryMutAct_9fa48(')}`);

// ---------- compile both versions with the instrumenter's own Babel 8 and render with React ----------

async function compile(code: string, name: string): Promise<string> {
  const out = await babel.transformAsync(code, {
    filename: name.replace(/\.mjs$/, '.tsx'),
    configFile: false,
    babelrc: false,
    browserslistConfigFile: false,
    presets: [
      instrumenterRequire.resolve('@babel/preset-typescript'),
      [instrumenterRequire.resolve('@babel/preset-react'), { runtime: 'automatic' }],
    ],
  });
  const target = join(outDir, name);
  writeFileSync(target, out.code);

  return pathToFileURL(target).href;
}

const ns: Record<string, unknown> = {};
(globalThis as any).__stryker__ = ns;
const { renderToStaticMarkup } = repoRequire('react-dom/server');
const React = repoRequire('react');
const original = await import(await compile(source, 'Dialog.original.mjs'));
const mutated = await import(await compile(instrumented, 'Dialog.instrumented.mjs'));

const propSets = [
  { open: false, busy: false, items: ['a', 'b'] },
  { open: true, busy: true, items: ['a', 'b'] },
];

function render(mod: any, props: Record<string, unknown>): string {
  return renderToStaticMarkup(React.createElement(mod.Dialog, { ...props, onClose() {}, onSave() {} }));
}

function handlers(mod: any, props: Record<string, unknown>): string {
  const found: string[] = [];
  const walk = (node: any) => {
    if (Array.isArray(node)) {
      node.forEach(walk);
    } else if (node && typeof node === 'object' && node.props) {
      for (const [k, v] of Object.entries(node.props)) {
        if (/^on[A-Z]/.test(k)) {
          found.push(`${typeof node.type === 'string' ? node.type : node.type.name}.${k}=${typeof v}`);
        }
      }
      walk(node.props.children);
    }
  };
  walk(mod.Dialog({ ...props, onClose() {}, onSave() {} }));

  return found.sort().join(' ');
}

for (const props of propSets) {
  ns.activeMutant = undefined;
  assert.equal(render(mutated, props), render(original, props), `baseline render equals original for ${JSON.stringify(props)}`);
  assert.equal(handlers(mutated, props), handlers(original, props), 'baseline handlers equal original');
}

const alive: string[] = [];

for (const m of custom) {
  let observed = false;

  for (const props of propSets) {
    ns.activeMutant = undefined;
    const baseHtml = render(original, props);
    const baseHandlers = handlers(original, props);
    ns.activeMutant = m.id;
    const html = render(mutated, props);
    const h = handlers(mutated, props);

    if (html !== baseHtml || h !== baseHandlers) {
      observed = true;
    }
  }

  if (!observed) {
    alive.push(`${m.mutatorName} ${m.replacement}`);
  }
}

ns.activeMutant = undefined;
console.log(`baseline render identical to original: yes (both prop sets)`);
console.log(`UI mutants that change the render or a handler prop when active: ${custom.length - alive.length}/${custom.length}`);

if (alive.length) {
  console.log(`not observable in this harness: ${alive.join('; ')}`);
}

// Spot checks on the exact rendered effect.
const show = (id: string, props = propSets[0]) => {
  ns.activeMutant = id;
  const html = render(mutated, props);
  ns.activeMutant = undefined;

  return html;
};
const byReplacement = (name: string, replacement: string) => custom.find((m: any) => m.mutatorName === name && m.replacement === replacement);
const checks: Array<[string, string, (html: string) => boolean]> = [
  ['JsxTextEmpty', '""', (html) => html.includes('<h1></h1>')],
  ['JsxAccessibleNameEmpty', 'aria-label=""', (html) => html.includes('aria-label=""')],
  ['JsxDisabledFlip', 'disabled={!busy}', (html) => /<button type="submit" disabled=""/.test(html)],
  ['JsxHiddenFlip', 'hidden={false}', (html) => html.includes('<p>Secret</p>')],
  ['JsxRoleRemoval', 'role={undefined}', (html) => !html.includes('role="dialog"')],
  ['JsxNavigationTarget', 'href="#"', (html) => html.includes('href="#">Docs')],
  ['JsxNavigationTarget', 'to="#"', (html) => html.includes('href="#">Help')],
  ['JsxButtonTypeSwap', 'type="button"', (html) => /<button type="button" disabled/.test(show(byReplacement('JsxButtonTypeSwap', 'type="button"').id, propSets[1]))],
  ['JsxConditionalRender', '<p role="status">Opened</p>', (html) => html.includes('role="status"')],
  ['JsxListTruncate', 'items.slice(0, 1).map(i => <li key={i}>{i}</li>)', (html) => (html.match(/<li>/g) ?? []).length === 1],
];

for (const [name, replacement, ok] of checks) {
  const m = byReplacement(name, replacement);
  assert.ok(m, `mutant ${name} ${replacement} generated`);
  assert.ok(ok(show(m.id)), `${name} ${replacement} renders the intended DOM`);
}

const closeHandler = byReplacement('JsxEventHandlerRemoval', 'onClick={undefined}');
ns.activeMutant = closeHandler.id;
assert.ok(handlers(mutated, propSets[0]).includes('button.onClick=undefined'), 'onClick removed from the close button');
ns.activeMutant = undefined;
console.log('spot checks: 10 DOM effects + onClick removal all as intended');
