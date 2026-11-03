import type { Ignorer } from '@stryker-mutator/api/ignore';

import { fieldOf, isRecord } from './is-record.ts';
import { packageName } from './package-name.ts';

const classNamePattern = /^\S+$/;

// Core merges the `properties` of each plugin's schema into its own (meta-schema-builder.js:27).
export const strykerValidationSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  properties: {
    lzJsxStyling: {
      type: 'object',
      additionalProperties: false,
      description: 'Options of the lz-jsx-styling ignorer.',
      properties: {
        visibilityClasses: {
          type: 'array',
          items: { type: 'string', pattern: classNamePattern.source },
          description:
            'Class names that hide an element, added to the built-in ones. lz-jsx-styling keeps the mutants of ' +
            'a class expression that holds one of them.',
        },
      },
    },
  },
};

const classReason =
  'lz-jsx-styling: class names only style the element; DOM tests do not observe them';
const builderReason =
  'lz-jsx-styling: class-name builder call; DOM tests do not observe class names';
const styleReason =
  'lz-jsx-styling: inline styles only style the element; DOM tests do not observe them';
const visibilityClasses = [
  'hidden',
  'invisible',
  'collapse',
  'sr-only',
  'not-sr-only',
  'd-none',
  'visually-hidden',
  'is-hidden',
];
const classBuilders: readonly unknown[] = [
  'cn',
  'clsx',
  'classnames',
  'classNames',
  'cx',
  'twMerge',
  'cva',
  'tv',
];
const classValueTypes: readonly unknown[] = [
  'StringLiteral',
  'TemplateLiteral',
  'ObjectExpression',
];
// Playwright counts an element hidden by its box, `visibility` and `display`; the box and position also decide
// `toBeInViewport` and clicks.
const boxKeys: readonly string[] = [
  'display',
  'visibility',
  'contentVisibility',
  'pointerEvents',
  'width',
  'height',
  'minWidth',
  'minHeight',
  'maxWidth',
  'maxHeight',
  'transform',
  'scale',
  'position',
  'top',
  'right',
  'bottom',
  'left',
  'inset',
  'overflow',
  'opacity',
  'clip',
  'clipPath',
];

export function stylingIgnorer(options: object): Ignorer {
  const hiding = new Set([
    ...visibilityClasses,
    ...userVisibilityClasses(options),
  ]);
  const hides = (node: unknown): boolean =>
    classTexts(node)
      .flatMap((text) => text.split(/\s+/))
      .some((token) => hiding.has(token.slice(token.lastIndexOf(':') + 1)));

  return {
    shouldIgnore(path) {
      const node = fieldOf(path, 'node');

      if (isPlainStyleAttribute(node)) {
        return styleReason;
      }

      const reason =
        isClassAttribute(node) || isClassVariable(node)
          ? classReason
          : isClassBuilderCall(node) && !insideClassAttribute(path)
            ? builderReason
            : undefined;

      return reason === undefined || hides(node) ? undefined : reason;
    },
  };
}

function userVisibilityClasses(options: object): readonly string[] {
  const own = fieldOf(fieldOf(options, 'lzJsxStyling'), 'visibilityClasses');

  if (own === undefined) {
    return [];
  }

  if (!isClassList(own)) {
    throw new Error(
      `${packageName}: lzJsxStyling.visibilityClasses must be an array of class names, each without whitespace, ` +
        `not ${JSON.stringify(own)}.`,
    );
  }

  return own;
}

function isClassList(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.every(
      (name: unknown) =>
        typeof name === 'string' && classNamePattern.test(name),
    )
  );
}

function isClassAttribute(node: unknown): boolean {
  const name = fieldOf(fieldOf(node, 'name'), 'name');

  return (
    typeOf(node) === 'JSXAttribute' &&
    (name === 'className' ||
      name === 'class' ||
      (typeof name === 'string' && name.endsWith('ClassName'))) &&
    typeOf(fieldOf(node, 'value')) === 'JSXExpressionContainer'
  );
}

function isPlainStyleAttribute(node: unknown): boolean {
  const value = fieldOf(fieldOf(node, 'value'), 'expression');
  const properties = fieldOf(value, 'properties');

  return (
    typeOf(node) === 'JSXAttribute' &&
    fieldOf(fieldOf(node, 'name'), 'name') === 'style' &&
    typeOf(value) === 'ObjectExpression' &&
    Array.isArray(properties) &&
    properties.every(isPlainStyleProperty)
  );
}

function isPlainStyleProperty(property: unknown): boolean {
  const key = fieldOf(property, 'key');
  const name =
    typeOf(key) === 'Identifier'
      ? fieldOf(key, 'name')
      : typeOf(key) === 'StringLiteral'
        ? fieldOf(key, 'value')
        : undefined;

  return (
    typeOf(property) !== 'SpreadElement' &&
    fieldOf(property, 'computed') === false &&
    typeof name === 'string' &&
    !boxKeys.includes(
      name.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase()),
    )
  );
}

function isClassVariable(node: unknown): boolean {
  const id = fieldOf(node, 'id');
  const name = fieldOf(id, 'name');

  return (
    typeOf(node) === 'VariableDeclarator' &&
    typeOf(id) === 'Identifier' &&
    typeof name === 'string' &&
    (name.endsWith('ClassName') || name.endsWith('Classes')) &&
    classValueTypes.includes(typeOf(fieldOf(node, 'init')))
  );
}

function isClassBuilderCall(node: unknown): boolean {
  const callee = fieldOf(node, 'callee');

  return (
    typeOf(node) === 'CallExpression' &&
    typeOf(callee) === 'Identifier' &&
    classBuilders.includes(fieldOf(callee, 'name'))
  );
}

function insideClassAttribute(path: unknown): boolean {
  const parent = fieldOf(path, 'parentPath');

  return (
    isRecord(parent) &&
    (isClassAttribute(parent['node']) || insideClassAttribute(parent))
  );
}

/** The strings in a subtree that can hold class names: string literals, template parts, and object keys. */
function classTexts(node: unknown): string[] {
  if (Array.isArray(node)) {
    return node.flatMap(classTexts);
  }

  if (!isRecord(node)) {
    return [];
  }

  const own = [
    typeOf(node) === 'StringLiteral' ? node['value'] : undefined,
    typeOf(node) === 'TemplateElement'
      ? fieldOf(node['value'], 'cooked')
      : undefined,
    typeOf(node) === 'ObjectProperty' &&
    node['computed'] === false &&
    typeOf(node['key']) === 'Identifier'
      ? fieldOf(node['key'], 'name')
      : undefined,
  ].filter((text) => typeof text === 'string');

  return [...own, ...Object.values(node).flatMap(classTexts)];
}

function typeOf(node: unknown): unknown {
  return fieldOf(node, 'type');
}
