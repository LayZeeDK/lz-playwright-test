import { fieldOf } from '@layzee/stryker-mutator-install';

import {
  callTypes,
  isNamedReceiver,
  isTestCallee,
  memberTypes,
} from './ast.ts';
import type { LzPlaywrightMutator } from './mutators.ts';
import { navigationFixtures } from './settings.ts';

export interface RemovalRow {
  readonly mutator: string;
  /** What the method is called on: anything but an input device, or `<receiver>` / `<x>.<receiver>`. */
  readonly receiver: 'any' | 'request' | 'clock';
  /** The positions that make no mutant: teardown, or setup hooks and `finally` blocks as well. */
  readonly skip: 'teardown' | 'setupAndTeardown';
}

// In place of `as const`: Stryker mutates nothing inside an `as` expression, which would leave every row out of a
// mutation run.
function removalTable<const T extends Readonly<Record<string, RemovalRow>>>(
  table: T,
): T {
  return table;
}

function row(mutator: string): RemovalRow {
  return { mutator, receiver: 'any', skip: 'teardown' };
}

function requestRow(): RemovalRow {
  return { mutator: input, receiver: 'request', skip: 'setupAndTeardown' };
}

function clockRow(): RemovalRow {
  return { mutator: clock, receiver: 'clock', skip: 'teardown' };
}

const click = 'LzPlaywrightClickAction';
const input = 'LzPlaywrightInputAction';
const focus = 'LzPlaywrightFocusAction';
const navigation = 'LzPlaywrightNavigationAction';
const sleep = 'LzPlaywrightSleepWait';
const state = 'LzPlaywrightStateWait';
const network = 'LzPlaywrightNetworkWait';
const clock = 'LzPlaywrightClock';

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
  delete: requestRow(),
  fetch: requestRow(),
  get: requestRow(),
  head: requestRow(),
  patch: requestRow(),
  post: requestRow(),
  put: requestRow(),
  waitForTimeout: row(sleep),
  waitForLoadState: row(state),
  waitForURL: row(state),
  waitFor: row(state),
  waitForSelector: row(state),
  waitForFunction: row(state),
  waitForResponse: row(network),
  waitForRequest: row(network),
  runFor: clockRow(),
  fastForward: clockRow(),
});

const teardownHooks: readonly unknown[] = ['afterEach', 'afterAll'];
const setupHooks: readonly unknown[] = ['beforeEach', 'beforeAll'];
const inputDevices: readonly unknown[] = ['keyboard', 'mouse', 'touchscreen'];
// The globals of Vitest and Jest, whose waitFor and friends share Playwright's method names.
const testRunners: readonly unknown[] = ['vi', 'jest'];

export function removalMutator<const TName extends string>(
  name: TName,
  sample: string,
): LzPlaywrightMutator & { readonly name: TName } {
  return {
    name,
    sample,
    *mutate(path, t) {
      const removal = removalOf(path);

      if (removal?.mutator === name && !isSkipped(path, removal.skip)) {
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
  const found =
    typeof method === 'string' && Object.hasOwn(rows, method)
      ? rows[method]
      : undefined;

  return found !== undefined &&
    found.receiver !== 'any' &&
    !isNamedReceiver(fieldOf(callee, 'object'), found.receiver)
    ? undefined
    : found;
}

/** The call of an `await <call>;` statement. */
function awaitedCall(node: unknown): unknown {
  if (fieldOf(node, 'type') !== 'ExpressionStatement') {
    return undefined;
  }

  const awaited = fieldOf(node, 'expression');
  const call = fieldOf(awaited, 'argument');

  return fieldOf(awaited, 'type') === 'AwaitExpression' &&
    callTypes.includes(fieldOf(call, 'type'))
    ? call
    : undefined;
}

/** The last member of the callee, when it is a member of something that is neither an input device nor a test runner. */
function awaitedMethod(callee: unknown): unknown {
  const object = fieldOf(callee, 'object');

  return memberTypes.includes(fieldOf(callee, 'type')) &&
    fieldOf(callee, 'computed') === false &&
    !inputDevices.includes(fieldOf(fieldOf(object, 'property'), 'name')) &&
    !testRunners.includes(fieldOf(object, 'name'))
    ? fieldOf(fieldOf(callee, 'property'), 'name')
    : undefined;
}

/** `name` is in the navigation fixture list and a test, hook or fixture function around `path` destructures it. */
function isNavigationFixture(path: unknown, name: unknown): boolean {
  if (typeof name !== 'string' || !navigationFixtures().includes(name)) {
    return false;
  }

  for (
    let current = fieldOf(path, 'parentPath');
    current !== undefined && current !== null;
    current = fieldOf(current, 'parentPath')
  ) {
    if (
      isFixtureFunction(current) &&
      destructures(fieldOf(fieldOf(current, 'node'), 'params'), name)
    ) {
      return true;
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

function isExtendCall(node: unknown): boolean {
  const callee = fieldOf(node, 'callee');

  return (
    fieldOf(node, 'type') === 'CallExpression' &&
    fieldOf(callee, 'type') === 'MemberExpression' &&
    fieldOf(fieldOf(callee, 'property'), 'name') === 'extend'
  );
}

function isSkipped(path: unknown, skip: RemovalRow['skip']): boolean {
  const setup = skip === 'setupAndTeardown';
  let child = path;

  for (
    let current = fieldOf(path, 'parentPath');
    current !== undefined && current !== null;
    current = fieldOf(current, 'parentPath')
  ) {
    if (
      isHookCall(
        fieldOf(current, 'node'),
        setup ? [...teardownHooks, ...setupHooks] : teardownHooks,
      ) ||
      followsUse(current, fieldOf(child, 'node')) ||
      (setup && isFinalizer(current, fieldOf(child, 'node')))
    ) {
      return true;
    }

    child = current;
  }

  return false;
}

function isHookCall(node: unknown, hooks: readonly unknown[]): boolean {
  const callee = fieldOf(node, 'callee');

  return (
    fieldOf(node, 'type') === 'CallExpression' &&
    fieldOf(callee, 'type') === 'MemberExpression' &&
    hooks.includes(fieldOf(fieldOf(callee, 'property'), 'name'))
  );
}

/** `child` is the `finally` block of the try statement at `tryPath`. */
function isFinalizer(tryPath: unknown, child: unknown): boolean {
  const node = fieldOf(tryPath, 'node');

  return (
    fieldOf(node, 'type') === 'TryStatement' &&
    fieldOf(node, 'finalizer') === child
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
