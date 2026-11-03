// withJsxPlacement against a fake original placer, on Babel trees and mutants the UI mutators never give: a bare
// attribute whose value is missing rather than null, and values the placer cannot hold.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { types as t } from '@babel/core';

import { withJsxPlacement, type PlacerMethods } from '../src/placer.ts';
import { firstPath, parse } from './support/babel.ts';

describe('withJsxPlacement', () => {
  function placeOn(
    code: string,
    type: 'JSXAttribute' | 'JSXText',
    original: PlacerMethods = { canPlace: () => false, place: () => undefined },
  ) {
    const path = firstPath(parse(code), type);
    const methods = withJsxPlacement(original, t);

    return {
      path,
      place: (mutant: t.Node) => methods.place(path, new Map([['1', mutant]])),
    };
  }

  it('places a bare attribute whose value is missing as {true}, and maps a missing mutant value the same way', () => {
    const placed: { node: t.Node; mutants: t.Node[] }[] = [];
    const { path, place } = placeOn('<input disabled />;', 'JSXAttribute', {
      canPlace: () => false,
      place: (placedPath, appliedMutants) => {
        placed.push({
          node: placedPath.node,
          mutants: [...appliedMutants.values()],
        });
      },
    });
    assert.ok(path.isJSXAttribute());
    delete path.node.value;
    const mutant = t.jsxAttribute(t.jsxIdentifier('disabled'));
    delete mutant.value;

    place(mutant);

    assert.deepEqual(
      placed.map(({ node, mutants }) => [
        node.type,
        t.isBooleanLiteral(node) && node.value,
        mutants,
      ]),
      [['BooleanLiteral', true, [t.booleanLiteral(true)]]],
    );
  });

  (
    [
      [
        'an attribute whose value is a JSX element',
        '<a href=<b /> />;',
        'JSXAttribute',
        t.jsxAttribute(t.jsxIdentifier('href'), t.stringLiteral('')),
      ],
      [
        'an attribute mutant whose value is an empty container',
        '<a href="/x" />;',
        'JSXAttribute',
        t.jsxAttribute(
          t.jsxIdentifier('href'),
          t.jsxExpressionContainer(t.jsxEmptyExpression()),
        ),
      ],
      [
        'an attribute mutant that is not an attribute',
        '<a href="/x" />;',
        'JSXAttribute',
        t.jsxText(''),
      ],
      [
        'an attribute mutant whose value is a JSX element',
        '<a href="/x" />;',
        'JSXAttribute',
        t.jsxAttribute(
          t.jsxIdentifier('href'),
          t.jsxElement(
            t.jsxOpeningElement(t.jsxIdentifier('b'), [], true),
            null,
            [],
          ),
        ),
      ],
      [
        'a text mutant that is not text',
        '<p>Hi</p>;',
        'JSXText',
        t.stringLiteral(''),
      ],
    ] as const
  ).forEach(([title, code, type, mutant]) => {
    it(`throws on ${title}`, () => {
      assert.throws(() => placeOn(code, type).place(mutant), {
        message: `@layzee/stryker-jsx-mutators: cannot place a UI mutant at a ${type}.`,
      });
    });
  });
});
