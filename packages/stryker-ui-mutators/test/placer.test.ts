// withJsxPlacement against a fake original placer, on a Babel tree the parser never gives: a bare attribute whose
// value is missing rather than null.
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
    delete (path.node as { value?: unknown }).value;
    const mutant = t.jsxAttribute(t.jsxIdentifier('disabled'));
    delete (mutant as { value?: unknown }).value;

    methods.place(path, new Map([['1', mutant]]));

    assert.deepEqual(
      placed.map(({ node, mutants }) => [
        node.type,
        (node as t.BooleanLiteral).value,
        mutants,
      ]),
      [['BooleanLiteral', true, [t.booleanLiteral(true)]]],
    );
  });
});
