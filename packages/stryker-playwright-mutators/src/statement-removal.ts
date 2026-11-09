import { fieldOf } from '@layzee/stryker-mutator-install';

import {
  ancestors,
  isCall,
  isFunctionNode,
  isNamedReceiver,
  isRequest,
  isTestCallee,
  methodOf,
} from './ast.ts';
import type { LzPlaywrightMutator } from './mutators.ts';
import { navigationFixtures } from './settings.ts';

export interface RemovalRow {
  readonly mutator: string;
  /**
   * What the method is called on: anything, or `<receiver>` / `<x>.<receiver>`. No row takes a call on an input
   * device or a test runner global.
   */
  readonly receiver: 'any' | 'request' | 'clock';
  /** The positions that make no mutant: teardown, or setup hooks and `finally` blocks as well. */
  readonly skip: 'teardown' | 'setupAndTeardown';
}

export const clickAction = 'LzPlaywrightClickAction';
export const inputAction = 'LzPlaywrightInputAction';
export const focusAction = 'LzPlaywrightFocusAction';
export const navigationAction = 'LzPlaywrightNavigationAction';
export const sleepWait = 'LzPlaywrightSleepWait';
export const stateWait = 'LzPlaywrightStateWait';
export const networkWait = 'LzPlaywrightNetworkWait';
export const clock = 'LzPlaywrightClock';

function row(mutator: string): RemovalRow {
  return { mutator, receiver: 'any', skip: 'teardown' };
}

const navigationRow = row(navigationAction);
const requestRow: RemovalRow = {
  mutator: inputAction,
  receiver: 'request',
  skip: 'setupAndTeardown',
};
const clockRow: RemovalRow = {
  mutator: clock,
  receiver: 'clock',
  skip: 'teardown',
};

/** The method an awaited call statement ends in, mapped to the one mutator that removes the statement. */
export const statementRemovals: Readonly<Record<string, RemovalRow>> = {
  click: row(clickAction),
  dblclick: row(clickAction),
  tap: row(clickAction),
  dragTo: row(clickAction),
  dispatchEvent: row(clickAction),
  dragAndDrop: row(clickAction),
  fill: row(inputAction),
  clear: row(inputAction),
  press: row(inputAction),
  pressSequentially: row(inputAction),
  type: row(inputAction),
  selectOption: row(inputAction),
  selectText: row(inputAction),
  setInputFiles: row(inputAction),
  drop: row(inputAction),
  check: row(inputAction),
  uncheck: row(inputAction),
  setChecked: row(inputAction),
  focus: row(focusAction),
  blur: row(focusAction),
  hover: row(focusAction),
  goto: navigationRow,
  reload: navigationRow,
  goBack: navigationRow,
  goForward: navigationRow,
  delete: requestRow,
  fetch: requestRow,
  get: requestRow,
  head: requestRow,
  patch: requestRow,
  post: requestRow,
  put: requestRow,
  waitForTimeout: row(sleepWait),
  waitForLoadState: row(stateWait),
  waitForURL: row(stateWait),
  waitFor: row(stateWait),
  waitForSelector: row(stateWait),
  waitForFunction: row(stateWait),
  waitForResponse: row(networkWait),
  waitForRequest: row(networkWait),
  runFor: clockRow,
  fastForward: clockRow,
};

const teardownHooks: readonly unknown[] = ['afterEach', 'afterAll'];
const setupHooks: readonly unknown[] = ['beforeEach', 'beforeAll'];

interface SkipPolicy {
  readonly hooks: readonly unknown[];
  readonly finallyBlocks: boolean;
}

const skipPolicies: Readonly<Record<RemovalRow['skip'], SkipPolicy>> = {
  teardown: { hooks: teardownHooks, finallyBlocks: false },
  setupAndTeardown: {
    hooks: [...teardownHooks, ...setupHooks],
    finallyBlocks: true,
  },
};

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

function removalOf(path: unknown): RemovalRow | undefined {
  const callee = fieldOf(awaitedCall(fieldOf(path, 'node')), 'callee');

  if (fieldOf(callee, 'type') === 'Identifier') {
    return isNavigationFixture(path, fieldOf(callee, 'name'))
      ? navigationRow
      : undefined;
  }

  const method = awaitedMethod(callee);
  const found =
    typeof method === 'string' && Object.hasOwn(statementRemovals, method)
      ? statementRemovals[method]
      : undefined;

  if (found === undefined || found.receiver === 'any') {
    return found;
  }

  const object = fieldOf(callee, 'object');
  const onReceiver =
    found.receiver === 'request'
      ? isRequest(path, object)
      : isNamedReceiver(object, found.receiver);

  return onReceiver ? found : undefined;
}

/** The call of an `await <call>;` statement. */
function awaitedCall(node: unknown): unknown {
  if (fieldOf(node, 'type') !== 'ExpressionStatement') {
    return undefined;
  }

  const awaited = fieldOf(node, 'expression');
  const call = fieldOf(awaited, 'argument');

  return fieldOf(awaited, 'type') === 'AwaitExpression' && isCall(call)
    ? call
    : undefined;
}

/** The last member of the callee, when it is a member of something that is neither an input device nor a test runner. */
function awaitedMethod(callee: unknown): unknown {
  const object = fieldOf(callee, 'object');

  return !inputDevices.includes(methodOf(object)) &&
    !testRunners.includes(fieldOf(object, 'name'))
    ? methodOf(callee)
    : undefined;
}

/** `name` is in the navigation fixture list and a test, hook or fixture function around `path` destructures it. */
function isNavigationFixture(path: unknown, name: unknown): boolean {
  if (typeof name !== 'string' || !navigationFixtures().includes(name)) {
    return false;
  }

  return [...ancestors(path)].some(
    (ancestor) =>
      isFixtureFunction(ancestor) &&
      destructures(fieldOf(fieldOf(ancestor, 'node'), 'params'), name),
  );
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

  if (!isFunctionNode(fieldOf(path, 'node'))) {
    return false;
  }

  if (isCall(owner)) {
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
  return isCall(node) && methodOf(fieldOf(node, 'callee')) === 'extend';
}

function isSkipped(path: unknown, skip: RemovalRow['skip']): boolean {
  const { hooks, finallyBlocks } = skipPolicies[skip];
  const chain = [path, ...ancestors(path)];

  return chain.slice(1).some((current, index) => {
    const child = fieldOf(chain[index], 'node');

    return (
      isHookCall(fieldOf(current, 'node'), hooks) ||
      followsUse(current, child) ||
      (finallyBlocks && isFinalizer(current, child))
    );
  });
}

function isHookCall(node: unknown, hooks: readonly unknown[]): boolean {
  return isCall(node) && hooks.includes(methodOf(fieldOf(node, 'callee')));
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

  return (
    fieldOf(block, 'type') === 'BlockStatement' &&
    Array.isArray(body) &&
    isFunctionNode(fieldOf(fieldOf(blockPath, 'parentPath'), 'node')) &&
    body.slice(0, body.indexOf(child)).some(isAwaitedUse)
  );
}

function isAwaitedUse(statement: unknown): boolean {
  const awaited = fieldOf(statement, 'expression');
  const call = fieldOf(awaited, 'argument');

  return (
    fieldOf(statement, 'type') === 'ExpressionStatement' &&
    fieldOf(awaited, 'type') === 'AwaitExpression' &&
    isCall(call) &&
    fieldOf(fieldOf(call, 'callee'), 'name') === 'use'
  );
}
