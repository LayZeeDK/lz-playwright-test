import { fieldOf } from '@layzee/stryker-mutator-install';

import type { LzPlaywrightMutator } from './mutators.ts';
import { navigationFixtures } from './settings.ts';

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
      const removal = removalOf(path);

      if (removal?.mutator === name && !isTeardown(path)) {
        yield t.emptyStatement();
      }
    },
  };
}

const rows: Readonly<Record<string, RemovalRow>> = statementRemovals;

function removalOf(path: unknown): RemovalRow | undefined {
  const callee = fieldOf(awaitedCall(fieldOf(path, 'node')), 'callee');

  if (fieldOf(callee, 'type') === 'Identifier') {
    return isNavigationFixture(path, fieldOf(callee, 'name'))
      ? row(navigation)
      : undefined;
  }

  const method = awaitedMethod(callee);

  return typeof method === 'string' && Object.hasOwn(rows, method)
    ? rows[method]
    : undefined;
}

/** The call of an `await <call>;` statement. */
function awaitedCall(node: unknown): unknown {
  if (fieldOf(node, 'type') !== 'ExpressionStatement') {
    return undefined;
  }

  const awaited = fieldOf(node, 'expression');
  const call = fieldOf(awaited, 'argument');

  return fieldOf(awaited, 'type') === 'AwaitExpression' &&
    fieldOf(call, 'type') === 'CallExpression'
    ? call
    : undefined;
}

/** The last member of the callee, when it is a member of something that is not an input device. */
function awaitedMethod(callee: unknown): unknown {
  return fieldOf(callee, 'type') === 'MemberExpression' &&
    fieldOf(callee, 'computed') === false &&
    !inputDevices.includes(
      fieldOf(fieldOf(fieldOf(callee, 'object'), 'property'), 'name'),
    )
    ? fieldOf(fieldOf(callee, 'property'), 'name')
    : undefined;
}

/** `name` is in the navigation fixture list and the test, hook or fixture function around `path` destructures it. */
function isNavigationFixture(path: unknown, name: unknown): boolean {
  if (typeof name !== 'string' || !navigationFixtures().includes(name)) {
    return false;
  }

  for (
    let current = fieldOf(path, 'parentPath');
    current !== undefined && current !== null;
    current = fieldOf(current, 'parentPath')
  ) {
    if (isFixtureFunction(current)) {
      return destructures(fieldOf(fieldOf(current, 'node'), 'params'), name);
    }
  }

  return false;
}

function destructures(params: unknown, name: string): boolean {
  const pattern: unknown = Array.isArray(params) ? params[0] : undefined;
  const properties = fieldOf(pattern, 'properties');

  return (
    fieldOf(pattern, 'type') === 'ObjectPattern' &&
    Array.isArray(properties) &&
    properties.some(
      (property) => fieldOf(fieldOf(property, 'value'), 'name') === name,
    )
  );
}

/** A function that Playwright calls with fixtures: an argument of `test(...)` or `test.<x>(...)`, or a `test.extend` fixture. */
function isFixtureFunction(path: unknown): boolean {
  const owner = fieldOf(path, 'parent');
  const ownerPath = fieldOf(path, 'parentPath');

  if (!/Function|Method/.test(String(fieldOf(fieldOf(path, 'node'), 'type')))) {
    return false;
  }

  if (fieldOf(owner, 'type') === 'CallExpression') {
    return isTestCallee(fieldOf(owner, 'callee'));
  }

  const objectPath =
    fieldOf(owner, 'type') === 'ObjectProperty'
      ? fieldOf(ownerPath, 'parentPath')
      : ownerPath;

  return (
    fieldOf(fieldOf(objectPath, 'node'), 'type') === 'ObjectExpression' &&
    isExtendCall(fieldOf(objectPath, 'parent'))
  );
}

function isTestCallee(callee: unknown): boolean {
  const target =
    fieldOf(callee, 'type') === 'MemberExpression'
      ? fieldOf(callee, 'object')
      : callee;

  return (
    fieldOf(target, 'type') === 'Identifier' &&
    fieldOf(target, 'name') === 'test'
  );
}

function isExtendCall(node: unknown): boolean {
  const callee = fieldOf(node, 'callee');

  return (
    fieldOf(node, 'type') === 'CallExpression' &&
    fieldOf(callee, 'type') === 'MemberExpression' &&
    fieldOf(fieldOf(callee, 'property'), 'name') === 'extend'
  );
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
