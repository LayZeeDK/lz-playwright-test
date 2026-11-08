import { fieldOf } from '@layzee/stryker-mutator-install';

import type { LzPlaywrightMutator } from './mutators.ts';

export interface RemovalRow {
  readonly mutator: string;
}

// In place of `as const`: Stryker mutates nothing inside an `as` expression, which would leave every row out of a
// mutation run.
function removalTable<const T extends Readonly<Record<string, RemovalRow>>>(
  table: T,
): T {
  return table;
}

function row(mutator: string): RemovalRow {
  return { mutator };
}

const click = 'LzPlaywrightClickAction';
const input = 'LzPlaywrightInputAction';
const focus = 'LzPlaywrightFocusAction';
const navigation = 'LzPlaywrightNavigationAction';

/** The method an awaited call statement ends in, mapped to the one mutator that removes the statement. */
export const statementRemovals = removalTable({
  click: row(click),
  dblclick: row(click),
  tap: row(click),
  dragTo: row(click),
  dispatchEvent: row(click),
  dragAndDrop: row(click),
  fill: row(input),
  clear: row(input),
  press: row(input),
  pressSequentially: row(input),
  type: row(input),
  selectOption: row(input),
  selectText: row(input),
  setInputFiles: row(input),
  drop: row(input),
  check: row(input),
  uncheck: row(input),
  setChecked: row(input),
  focus: row(focus),
  blur: row(focus),
  hover: row(focus),
  goto: row(navigation),
  reload: row(navigation),
  goBack: row(navigation),
  goForward: row(navigation),
});

const teardownHooks: readonly unknown[] = ['afterEach', 'afterAll'];
const inputDevices: readonly unknown[] = ['keyboard', 'mouse', 'touchscreen'];

export function removalMutator<const TName extends string>(
  name: TName,
  sample: string,
): LzPlaywrightMutator & { readonly name: TName } {
  return {
    name,
    sample,
    *mutate(path, t) {
      const removal = removalOf(fieldOf(path, 'node'));

      if (removal?.mutator === name && !isTeardown(path)) {
        yield t.emptyStatement();
      }
    },
  };
}

const rows: Readonly<Record<string, RemovalRow>> = statementRemovals;

function removalOf(node: unknown): RemovalRow | undefined {
  const method = awaitedMethod(node);

  return typeof method === 'string' && Object.hasOwn(rows, method)
    ? rows[method]
    : undefined;
}

/** The last member of the callee, for an `await <call>;` statement. */
function awaitedMethod(node: unknown): unknown {
  if (fieldOf(node, 'type') !== 'ExpressionStatement') {
    return undefined;
  }

  const awaited = fieldOf(node, 'expression');
  const call = fieldOf(awaited, 'argument');

  if (
    fieldOf(awaited, 'type') !== 'AwaitExpression' ||
    fieldOf(call, 'type') !== 'CallExpression'
  ) {
    return undefined;
  }

  const callee = fieldOf(call, 'callee');

  return fieldOf(callee, 'type') === 'MemberExpression' &&
    fieldOf(callee, 'computed') === false &&
    !inputDevices.includes(
      fieldOf(fieldOf(fieldOf(callee, 'object'), 'property'), 'name'),
    )
    ? fieldOf(fieldOf(callee, 'property'), 'name')
    : undefined;
}

function isTeardown(path: unknown): boolean {
  let child = path;

  for (
    let current = fieldOf(path, 'parentPath');
    current !== undefined && current !== null;
    current = fieldOf(current, 'parentPath')
  ) {
    if (
      isTeardownHookCall(fieldOf(current, 'node')) ||
      followsUse(current, fieldOf(child, 'node'))
    ) {
      return true;
    }

    child = current;
  }

  return false;
}

function isTeardownHookCall(node: unknown): boolean {
  const callee = fieldOf(node, 'callee');

  return (
    fieldOf(node, 'type') === 'CallExpression' &&
    fieldOf(callee, 'type') === 'MemberExpression' &&
    teardownHooks.includes(fieldOf(fieldOf(callee, 'property'), 'name'))
  );
}

/** `child` sits in a function body, after a statement of that body that is `await use(...)`. */
function followsUse(blockPath: unknown, child: unknown): boolean {
  const block = fieldOf(blockPath, 'node');
  const body = fieldOf(block, 'body');
  const owner = fieldOf(
    fieldOf(fieldOf(blockPath, 'parentPath'), 'node'),
    'type',
  );

  return (
    fieldOf(block, 'type') === 'BlockStatement' &&
    Array.isArray(body) &&
    typeof owner === 'string' &&
    /Function|Method/.test(owner) &&
    body.slice(0, body.indexOf(child)).some(isAwaitedUse)
  );
}

function isAwaitedUse(statement: unknown): boolean {
  const awaited = fieldOf(statement, 'expression');
  const call = fieldOf(awaited, 'argument');

  return (
    fieldOf(statement, 'type') === 'ExpressionStatement' &&
    fieldOf(awaited, 'type') === 'AwaitExpression' &&
    fieldOf(call, 'type') === 'CallExpression' &&
    fieldOf(fieldOf(call, 'callee'), 'name') === 'use'
  );
}
