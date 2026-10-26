import type { NodePath, types } from '@babel/core';

import { isJsxChild, type BabelTypes } from './mutator.ts';

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
          valueExpression(path.node.value, t),
        );
        place(
          child(path, 'value.expression'),
          remap(appliedMutants, (node) =>
            valueExpression((node as types.JSXAttribute).value, t),
          ),
        );

        return;
      }

      if (path.isJSXText()) {
        const [container] = path.replaceWith(
          t.jsxExpressionContainer(cleanedText(path.node, t)),
        );
        place(
          child(container, 'expression'),
          remap(appliedMutants, (node) =>
            cleanedText(node as types.JSXText, t),
          ),
        );

        return;
      }

      if (isJsxChild(path)) {
        const [container] = path.replaceWith(
          t.jsxExpressionContainer(path.node as types.Expression),
        );
        place(child(container, 'expression'), appliedMutants);

        return;
      }

      place(path, appliedMutants);
    },
  };
}

// The `as` stays here, around no code Stryker could mutate, as it skips `as` expressions.
function child(path: NodePath, key: string): NodePath {
  return path.get(key) as NodePath;
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

function valueExpression(
  value: types.JSXAttribute['value'],
  t: BabelTypes,
): types.Expression {
  if (value === null || value === undefined) {
    return t.booleanLiteral(true);
  }

  // A fresh StringLiteral drops the `extra.raw` that holds undecoded entities such as `&amp;`.
  if (t.isStringLiteral(value)) {
    return t.stringLiteral(value.value);
  }

  return (value as types.JSXExpressionContainer).expression as types.Expression;
}

function cleanedText(node: types.JSXText, t: BabelTypes): types.Expression {
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
