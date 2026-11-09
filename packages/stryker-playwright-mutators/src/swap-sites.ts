import { fieldOf } from '@layzee/stryker-mutator-install';

import { argumentOf, findProperty, isNamedReceiver, methodOf } from './ast.ts';
import type { Site, SiteReader } from './same-file-swap.ts';

/**
 * What tells two locator values apart: a string literal and an expression-free template literal by their text, a
 * regex literal by pattern and flags. A string and a regex never compare equal.
 */
function valueOf(node: unknown): string | undefined {
  switch (fieldOf(node, 'type')) {
    case 'StringLiteral':
    case 'TemplateLiteral': {
      const text = textOf(node);

      return text === undefined ? undefined : `string:${text}`;
    }
    case 'RegExpLiteral': {
      const pattern = fieldOf(node, 'pattern');
      const flags = fieldOf(node, 'flags');

      return typeof pattern === 'string' && typeof flags === 'string'
        ? `regex:/${pattern}/${flags}`
        : undefined;
    }
    default:
      return undefined;
  }
}

/** The text of a string literal or of an expression-free template literal. */
function textOf(node: unknown): string | undefined {
  switch (fieldOf(node, 'type')) {
    case 'StringLiteral': {
      const text = fieldOf(node, 'value');

      return typeof text === 'string' ? text : undefined;
    }
    case 'TemplateLiteral': {
      const quasis = fieldOf(node, 'quasis');
      const text = fieldOf(
        fieldOf(Array.isArray(quasis) ? quasis[0] : undefined, 'value'),
        'cooked',
      );

      return Array.isArray(quasis) &&
        quasis.length === 1 &&
        typeof text === 'string'
        ? text
        : undefined;
    }
    default:
      return undefined;
  }
}

export function roleSite(call: unknown): Site | undefined {
  const role = argumentOf(call, 0);
  const name = fieldOf(findProperty(argumentOf(call, 1), 'name'), 'value');
  const value = valueOf(name);

  return methodOf(fieldOf(call, 'callee')) === 'getByRole' &&
    fieldOf(role, 'type') === 'StringLiteral' &&
    value !== undefined
    ? { key: `getByRole:${valueOf(role)}`, value, node: name }
    : undefined;
}

/** The first argument of a call to one of the methods; the method is the key. */
function firstArgumentSite(methods: readonly string[]): SiteReader {
  return (call) => {
    const method = methodOf(fieldOf(call, 'callee'));
    const argument = argumentOf(call, 0);
    const value = valueOf(argument);

    return typeof method === 'string' &&
      methods.includes(method) &&
      value !== undefined
      ? { key: method, value, node: argument }
      : undefined;
  };
}

/** `Button/Primary` and `components/Button/Primary` name the same story. */
export function isSameStory(one: string, other: string): boolean {
  return (
    one === other || one.endsWith(`/${other}`) || other.endsWith(`/${one}`)
  );
}

export function mountStorySite(call: unknown): Site | undefined {
  const argument = argumentOf(call, 0);
  const value = textOf(argument);

  return isNamedReceiver(fieldOf(call, 'callee'), 'mount') &&
    value !== undefined
    ? { key: 'mount', value, node: argument }
    : undefined;
}

export const testIdSite = firstArgumentSite(['getByTestId']);

export const textSite = firstArgumentSite([
  'getByText',
  'getByLabel',
  'getByPlaceholder',
  'getByAltText',
  'getByTitle',
]);
