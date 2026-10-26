// JSX-safe placement for Stryker's expression placer. Pure: it builds new methods from the placer's own and
// never touches the live object; install.ts is the only module that assigns them.
import type { NodePath, types } from '@babel/core';

import { isJsxChild, type BabelTypes } from './mutator.ts';

/** The shape of Stryker's `MutantPlacer` (instrumenter `mutant-placers/mutant-placer.ts`), mutant ids opaque. */
export interface MutantPlacerLike {
  readonly name: string;
  canPlace(path: NodePath): boolean;
  place(path: NodePath, appliedMutants: Map<unknown, types.Node>): void;
}

export type PlacerMethods = Pick<MutantPlacerLike, 'canPlace' | 'place'>;

/**
 * `original`'s methods, extended so that:
 * - a `JSXAttribute` is a placement site: its value becomes `{expr}` (bare -> `true`, string -> a fresh
 *   StringLiteral, which drops the `extra.raw` that holds undecoded entities such as `&amp;`), each mutant's
 *   replacement attribute maps the same way (`{undefined}` for a removed attribute), then `original.place` runs
 *   on that expression;
 * - a `JSXText` is a placement site: it becomes `{"text"}`, cleaned by `t.react.buildChildren` as the JSX
 *   transform cleans it; emptied text becomes `null`, which renders exactly like no child;
 * - an expression among JSX children (an `ElementToSpan` swap) is wrapped in a `JSXExpressionContainer` first;
 * - everything else goes to `original` unchanged. Built-in mutators never mutate a `JSXAttribute` or `JSXText`,
 *   and built-in mutants inside an attribute's expression find that expression as their nearest site first, so
 *   their placement does not change (test/placement.test.ts proves it on a corpus).
 */
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
          path.get('value.expression') as NodePath,
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
          container.get('expression') as NodePath,
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
        place(container.get('expression') as NodePath, appliedMutants);

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
    [...applied].map(([mutant, node]) => [mutant, to(node)] as const),
  );
}

function valueExpression(
  value: types.JSXAttribute['value'],
  t: BabelTypes,
): types.Expression {
  if (value === null || value === undefined) {
    return t.booleanLiteral(true);
  }

  if (t.isStringLiteral(value)) {
    return t.stringLiteral(value.value);
  }

  // The rules never match a JSX element value or an empty container (mutator.ts readValue).
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
