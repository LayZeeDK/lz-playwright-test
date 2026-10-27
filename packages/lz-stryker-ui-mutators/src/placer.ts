import type { NodePath, types } from '@babel/core';

import { decodeValue, isJsxChild, type BabelTypes } from './mutator.ts';

export interface MutantPlacerLike {
  readonly name: string;
  canPlace(path: NodePath): boolean;
  place(path: NodePath, appliedMutants: Map<unknown, types.Node>): void;
}

export type PlacerMethods = Pick<MutantPlacerLike, 'canPlace' | 'place'>;

export function withJsxPlacement(
  original: PlacerMethods,
  t: BabelTypes,
): PlacerMethods {
  const canPlace = original.canPlace.bind(original);
  const place = original.place.bind(original);

  return {
    canPlace: (path) =>
      canPlace(path) || path.isJSXAttribute() || path.isJSXText(),
    place(path, appliedMutants) {
      if (path.isJSXAttribute()) {
        path.node.value = t.jsxExpressionContainer(
          valueExpression(path.node, t),
        );
        const value = path.get('value');

        if (value.isJSXExpressionContainer()) {
          place(
            value.get('expression'),
            remap(appliedMutants, (node) => valueExpression(node, t)),
          );
        }

        return;
      }

      if (path.isJSXText()) {
        const [container] = path.replaceWith(
          t.jsxExpressionContainer(cleanedText(path.node, t)),
        );
        place(
          container.get('expression'),
          remap(appliedMutants, (node) => cleanedText(node, t)),
        );

        return;
      }

      if (isJsxChild(path) && path.isExpression()) {
        const [container] = path.replaceWith(
          t.jsxExpressionContainer(path.node),
        );
        place(container.get('expression'), appliedMutants);

        return;
      }

      place(path, appliedMutants);
    },
  };
}

function remap(
  applied: Map<unknown, types.Node>,
  to: (node: types.Node) => types.Expression,
): Map<unknown, types.Node> {
  return new Map(
    [...applied].map(([mutant, node]): [unknown, types.Node] => [
      mutant,
      to(node),
    ]),
  );
}

function unplaceable(type: string): Error {
  return new Error(
    `lz-stryker-ui-mutators: cannot place a UI mutant at a ${type}.`,
  );
}

function valueExpression(
  attribute: types.Node,
  t: BabelTypes,
): types.Expression {
  if (!t.isJSXAttribute(attribute)) {
    throw unplaceable('JSXAttribute');
  }

  const value = decodeValue(attribute.value, t);

  if (value.kind === 'bare') {
    return t.booleanLiteral(true);
  }

  // A fresh StringLiteral drops the `extra.raw` that holds undecoded entities such as `&amp;`.
  if (value.kind === 'string') {
    return t.stringLiteral(value.text);
  }

  if (value.kind === 'expression') {
    return value.expression;
  }

  throw unplaceable('JSXAttribute');
}

function cleanedText(node: types.Node, t: BabelTypes): types.Expression {
  if (!t.isJSXText(node)) {
    throw unplaceable('JSXText');
  }

  // Stryker disable StringLiteral: equivalent, as t.react.buildChildren reads only the element's children
  const element = t.jsxElement(
    t.jsxOpeningElement(t.jsxIdentifier('x'), []),
    t.jsxClosingElement(t.jsxIdentifier('x')),
    [node],
  );
  // Stryker restore StringLiteral
  const [child] = t.react.buildChildren(element);

  return t.isStringLiteral(child)
    ? t.stringLiteral(child.value)
    : t.nullLiteral();
}
