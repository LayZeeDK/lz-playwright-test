// Resolves vitest/node the way Node does when the vitest package is not installed.
export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'vitest/node') {
    throw Object.assign(
      new Error(
        `Cannot find package 'vitest' imported from ${context.parentURL}`,
      ),
      { code: 'ERR_MODULE_NOT_FOUND' },
    );
  }

  return nextResolve(specifier, context);
}
