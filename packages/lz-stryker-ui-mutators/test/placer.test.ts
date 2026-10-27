// withJsxPlacement against a fake original placer, on Babel trees and mutants the UI operators never give: a bare
// attribute whose value is missing rather than null, and values the placer cannot hold.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseSync, traverse, types as t, type NodePath } from '@babel/core';

import { withJsxPlacement } from '../src/placer.ts';

describe('withJsxPlacement', () => {
  it('places a bare attribute whose value is missing as {true}, and maps a missing mutant value the same way', () => {
    const file = parseSync('<input disabled />;', {
      configFile: false,
      babelrc: false,
      parserOpts: { plugins: ['jsx'] },
    });
    assert.ok(file);
    const placed: { node: t.Node; mutants: t.Node[] }[] = [];
    const methods = withJsxPlacement(
      {
        canPlace: () => false,
        place: (path, appliedMutants) => {
          placed.push({
            node: path.node,
            mutants: [...appliedMutants.values()],
          });
        },
      },
      t,
    );
    const attributes: NodePath<t.JSXAttribute>[] = [];

    traverse(file, {
      JSXAttribute(path) {
        attributes.push(path);
      },
    });
    const [path] = attributes;
    assert.ok(path);
    delete path.node.value;
    const mutant = t.jsxAttribute(t.jsxIdentifier('disabled'));
    delete mutant.value;

    methods.place(path, new Map([['1', mutant]]));

    assert.deepEqual(
      placed.map(({ node, mutants }) => [
        node.type,
        t.isBooleanLiteral(node) && node.value,
        mutants,
      ]),
      [['BooleanLiteral', true, [t.booleanLiteral(true)]]],
    );
  });

  /** The first path of `type` in `code`, and a placer whose original takes every placement silently. */
  function placeOn(code: string, type: 'JSXAttribute' | 'JSXText') {
    const file = parseSync(code, {
      configFile: false,
      babelrc: false,
      parserOpts: { plugins: ['jsx'] },
    });
    assert.ok(file);
    const paths: NodePath[] = [];

    traverse(file, {
      enter(path) {
        if (path.type === type) {
          paths.push(path);
        }
      },
    });
    const [path] = paths;
    assert.ok(path);
    const methods = withJsxPlacement(
      { canPlace: () => false, place: () => undefined },
      t,
    );

    return (mutant: t.Node) => methods.place(path, new Map([['1', mutant]]));
  }

  for (const [title, code, type, mutant] of [
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
  ] as const) {
    it(`throws on ${title}`, () => {
      assert.throws(() => placeOn(code, type)(mutant), {
        message: `lz-stryker-ui-mutators: cannot place a UI mutant at a ${type}.`,
      });
    });
  }
});
