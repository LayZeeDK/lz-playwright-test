import { isRecord } from './is-record.ts';

type Writable<T> = { -readonly [K in keyof T]: T[K] };

/**
 * The global that Stryker's instrumented code and the hooks share, in a worker, a page or a server.
 * Instrumented code may create it first, so each field claims nothing.
 */
export type StrykerNamespace = Writable<StrykerNamespaceFields>;

interface StrykerNamespaceFields {
  readonly activeMutant?: unknown;
  readonly currentTestId?: unknown;
  readonly mutantCoverage?: unknown;
  readonly hitCount?: unknown;
  readonly hitLimit?: unknown;
}

export function globalNamespace(name: string): StrykerNamespace {
  const scope: Record<string, unknown> = globalThis;
  const found = scope[name];

  if (isRecord(found)) {
    return found;
  }

  const created: StrykerNamespace = {};
  scope[name] = created;

  return created;
}
