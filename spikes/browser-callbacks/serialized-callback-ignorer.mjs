// Ignores every function passed to a Playwright method that sends the function's source text to another realm.
const serializingMethods = new Set([
  'evaluate',
  'evaluateHandle',
  'evaluateAll',
  '$eval',
  '$$eval',
  'addInitScript',
  'waitForFunction',
]);

export default {
  shouldIgnore(path) {
    if (
      !(path.isFunctionExpression() || path.isArrowFunctionExpression()) ||
      path.listKey !== 'arguments'
    ) {
      return undefined;
    }

    const callee = path.parentPath.node.callee;
    const name =
      callee.type === 'MemberExpression' && !callee.computed
        ? callee.property.name
        : undefined;

    return serializingMethods.has(name)
      ? `Playwright sends this function's source text to the browser, where Stryker's helpers do not exist`
      : undefined;
  },
};
