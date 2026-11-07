export function envOf(
  names: readonly string[],
): Record<string, string | undefined> {
  return Object.fromEntries(names.map((name) => [name, process.env[name]]));
}

export async function withEnv<T>(
  values: Readonly<Record<string, string | undefined>>,
  fn: () => Promise<T>,
): Promise<T> {
  const previous = envOf(Object.keys(values));
  setEnv(values);

  try {
    return await fn();
  } finally {
    setEnv(previous);
  }
}

export function setEnv(values: Readonly<Record<string, string | undefined>>) {
  Object.entries(values).forEach(([name, value]) => {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  });
}
