// toNodeMutator and isJsxChild on Babel trees that the parser never gives (a JSX attribute outside an element, a
// bare attribute whose value is missing rather than null, the program root), and the ElementSite a rule sees.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { traverse, types as t, type NodePath } from '@babel/core';

import {
  isJsxChild,
  toNodeMutator,
  type AttributeSite,
  type Operator,
} from '../src/mutator.ts';
import { parse } from './support/babel.ts';

function firstElement(file: t.File): t.JSXElement {
  const [statement] = file.program.body;
  assert.ok(
    t.isExpressionStatement(statement) && t.isJSXElement(statement.expression),
  );

  return statement.expression;
}

/** Runs an operator with one rule on `attribute` over every path of `file`; returns the sites its skip saw. */
function sitesOf(file: t.File, attribute: string): AttributeSite[] {
  const sites: AttributeSite[] = [];
  const operator: Operator = {
    name: 'Probe',
    sample: '',
    rules: [
      {
        kind: 'attribute',
        attributes: [attribute],
        on: { bare: 'remove', string: 'remove' },
        skip: (site) => {
          sites.push(site);

          return true;
        },
      },
    ],
  };
  const mutator = toNodeMutator(operator, t);

  traverse(file, {
    enter(path) {
      assert.deepEqual(
        [...mutator.mutate(path, { isExpressionContext: true })],
        [],
      );
    },
  });

  return sites;
}

describe('toNodeMutator', () => {
  it("gives a rule the element's plain attribute names, leaving out spread and namespaced ones", () => {
    const [site] = sitesOf(
      parse('<a {...rest} xlink:href="#x" href="/x" data-x="1" />;'),
      'href',
    );

    assert.equal(site?.element.name, 'a');
    assert.deepEqual([...(site?.element.attributes ?? [])], ['href', 'data-x']);
  });

  it('reads an attribute whose value is missing, as a hand-built tree has it, as bare', () => {
    const file = parse('<input disabled />;');
    const [attribute] = firstElement(file).openingElement.attributes;
    assert.ok(t.isJSXAttribute(attribute));
    delete attribute.value;

    const sites = sitesOf(file, 'disabled');

    assert.deepEqual(
      sites.map(({ value }) => value),
      [{ kind: 'bare' }],
    );
  });

  it('finds no site for a JSX element as the value, or for an empty expression container, as a hand-built tree has it', () => {
    const file = parse('<a href=<b /> />;');
    const empty = parse('<a href="/x" />;');
    const [attribute] = firstElement(empty).openingElement.attributes;
    assert.ok(t.isJSXAttribute(attribute));
    attribute.value = t.jsxExpressionContainer(t.jsxEmptyExpression());

    assert.deepEqual([sitesOf(file, 'href'), sitesOf(empty, 'href')], [[], []]);
  });

  it('finds no site for an attribute whose opening element has no parent path, as in a traversal of the element alone', () => {
    const element = firstElement(parse('<input disabled />;'));
    const mutator = toNodeMutator(
      {
        name: 'Probe',
        sample: '',
        rules: [
          {
            kind: 'attribute',
            attributes: ['disabled'],
            on: { bare: 'remove' },
          },
        ],
      },
      t,
    );
    const yielded: t.Node[] = [];

    traverse(element, {
      noScope: true,
      enter(path) {
        yielded.push(...mutator.mutate(path, { isExpressionContext: true }));
      },
    });

    assert.deepEqual(yielded, []);
  });
});

describe('isJsxChild', () => {
  it('is false for the program, which has no parent', () => {
    const paths: NodePath[] = [];

    traverse(parse('<p>{x}</p>;'), {
      Program(path) {
        paths.push(path);
      },
    });

    assert.deepEqual(
      paths.map((path) => isJsxChild(path)),
      [false],
    );
  });
});
