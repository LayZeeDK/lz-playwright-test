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
// Keys that change only how an element is painted. Any other key can change its box, position or visibility, which
// Playwright's visibility, viewport and click checks and the app's own layout measurements read.
const paintKeys: readonly string[] = [
  'color',
  'background',
  'backgroundColor',
  'backgroundImage',
  'borderColor',
  'borderTopColor',
  'borderRightColor',
  'borderBottomColor',
  'borderLeftColor',
  'borderRadius',
  'outlineColor',
  'boxShadow',
  'textShadow',
  'textDecorationColor',
  'accentColor',
  'caretColor',
  'cursor',
  'fill',
  'stroke',
];

export function stylingIgnorer(options: object): Ignorer {
  const hiding = new Set(hidingClasses(options));
  const hides = (node: unknown): boolean =>
    classTexts(node)
      .flatMap((text) => text.split(/\s/))
      .some((token) => hiding.has(token.slice(token.lastIndexOf(':') + 1)));

  return {
    shouldIgnore(path) {
      const node = fieldOf(path, 'node');

      if (isPlainStyleAttribute(node)) {
        return styleReason;
      }

      if (isClassAttribute(node) || isClassVariable(node)) {
        return hides(node) ? undefined : classReason;
      }

      if (isClassBuilderCall(node) && !insideClassAttribute(path)) {
        return hides(node) ? undefined : builderReason;
      }

      return undefined;
    },
  };
}

function hidingClasses(options: object): readonly string[] {
  const own = fieldOf(fieldOf(options, 'lzJsxStyling'), 'visibilityClasses');

  if (own === undefined) {
    return visibilityClasses;
  }

  if (!isClassList(own)) {
    throw new Error(
      `${packageName}: lzJsxStyling.visibilityClasses must be an array of class names, each without whitespace, ` +
        `not ${JSON.stringify(own)}.`,
    );
  }

  return [...visibilityClasses, ...own];
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
    fieldOf(fieldOf(node, 'name'), 'name') === 'style' &&
    Array.isArray(properties) &&
    properties.every(isPlainStyleProperty)
  );
}

function isPlainStyleProperty(property: unknown): boolean {
  const key = fieldOf(property, 'key');
  const name = fieldOf(key, 'name') ?? fieldOf(key, 'value');

  return (
    fieldOf(property, 'computed') === false &&
    typeof name === 'string' &&
    paintKeys.includes(
      name.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase()),
    )
  );
}

function isClassVariable(node: unknown): boolean {
  const name = fieldOf(fieldOf(node, 'id'), 'name');

  return (
    typeof name === 'string' &&
    (name.endsWith('ClassName') || name.endsWith('Classes')) &&
    classValueTypes.includes(typeOf(fieldOf(node, 'init')))
  );
}

function isClassBuilderCall(node: unknown): boolean {
  return (
    typeOf(node) === 'CallExpression' &&
    classBuilders.includes(fieldOf(fieldOf(node, 'callee'), 'name'))
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
  if (!isRecord(node)) {
    return [];
  }

  const own = [
    typeOf(node) === 'StringLiteral' ? node['value'] : undefined,
    fieldOf(node['value'], 'cooked'),
    node['computed'] === false ? fieldOf(node['key'], 'name') : undefined,
  ].filter((text) => typeof text === 'string');

  return [...own, ...Object.values(node).flatMap(classTexts)];
}

function typeOf(node: unknown): unknown {
  return fieldOf(node, 'type');
}
