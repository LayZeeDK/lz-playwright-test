// Fails to resolve vitest/node for a reason other than a missing package.
export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'vitest/node') {
    throw Object.assign(new Error('vitest/node of the broken-vitest fixture'), {
      code: 'ERR_PACKAGE_PATH_NOT_EXPORTED',
    });
  }

  return nextResolve(specifier, context);
}
