// LzElementRole with a role table other than the bundled one, run through toNodeMutator over every path of a file.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { traverse, types as t } from '@babel/core';

import { elementSiteOf, toNodeMutator } from '../src/mutator.ts';
import { operatorsFor } from '../src/operators.ts';
import type { RoleTable } from '../src/playwright-roles.ts';
import { parse } from './support/babel.ts';
import { defined } from './support/defined.ts';

/** Each element that LzElementRole changes in `code` under `roles`, as `<name attributes> -> what it yields`. */
function elementRoleMutants(code: string, roles: RoleTable): string[] {
  const file = parse(code);
  const mutator = toNodeMutator(
    defined(operatorsFor(roles).find(({ name }) => name === 'LzElementRole')),
    t,
  );
  const show = (node: t.Node): string => {
    const element = elementSiteOf(node, t);

    return element === undefined
      ? node.type
      : `<${[element.name, ...element.attributes].join(' ')}>`;
  };
  const found: string[] = [];

  traverse(file, {
    enter(path) {
      const node = path.isJSXAttribute() ? path.parentPath.parent : path.node;
      found.push(
        ...[...mutator.mutate(path, { isExpressionContext: true })].map(
          (replacement) => `${show(node)} -> ${show(replacement)}`,
        ),
      );
    },
  });

  return found;
}

describe('LzElementRole', () => {
  it('swaps for a span exactly the elements whose role in the table is button or link', () => {
    const roles: RoleTable = new Map([
      ['div', { role: 'button' }],
      ['nav', { role: 'link', attribute: 'data-to' }],
      ['p', { role: 'paragraph' }],
    ]);

    assert.deepEqual(
      elementRoleMutants(
        '<div><nav data-to="x" /><nav /><p /><button /><a href="/" /></div>;',
        roles,
      ),
      ['<div> -> <span>', '<nav data-to> -> <span data-to>'],
    );
  });

  it('keeps a role attribute that restates the role the table gives', () => {
    const roles: RoleTable = new Map([['div', { role: 'button' }]]);

    assert.deepEqual(
      elementRoleMutants(
        '<b><div role="button" /><p role="button" /></b>;',
        roles,
      ),
      ['<div role> -> <span role>', '<p role> -> JSXAttribute'],
    );
  });
});
