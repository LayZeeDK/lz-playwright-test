const registryKey = '__STORYBOOK_MODULE_MOCK_SPIES__';

export function resetModuleMockSpies(): void {
  const registry: unknown = Reflect.get(globalThis, registryKey);

  if (registry instanceof Set) {
    const spies: Set<unknown> = registry;

    for (const spy of spies) {
      const mockReset: unknown =
        spy instanceof Object ? Reflect.get(spy, 'mockReset') : undefined;

      if (typeof mockReset !== 'function') {
        throw new TypeError(
          `${registryKey} holds a value without mockReset(), where Storybook's sb.mock keeps only spies`,
        );
      }

      Reflect.apply(mockReset, spy, []);
    }
  }
}
