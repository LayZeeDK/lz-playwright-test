import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

import type { Logger } from '@stryker-mutator/api/logging';

import { fieldOf } from './is-record.ts';

export class StrykerHelpersChanged extends Error {
  constructor(what: string) {
    super(
      `The installed @stryker-mutator/instrumenter changed the helpers it puts in instrumented files (${what}), so the Playwright test runner cannot give pages Stryker's helpers.`,
    );
  }
}

const probeName = 'lzStrykerProbe';

const off = () => false;
const ignore = () => undefined;
const silentLog: Logger = {
  isTraceEnabled: off,
  isDebugEnabled: off,
  isInfoEnabled: off,
  isWarnEnabled: off,
  isErrorEnabled: off,
  isFatalEnabled: off,
  trace: ignore,
  debug: ignore,
  info: ignore,
  warn: ignore,
  error: ignore,
  fatal: ignore,
};

function captured(text: string, pattern: RegExp): string[] {
  return [...text.matchAll(pattern)].flatMap(([, name]) => name ?? []);
}

export async function loadPageHelpers(): Promise<string> {
  const core = createRequire(
    createRequire(import.meta.url).resolve(
      '@stryker-mutator/core/package.json',
    ),
  );
  const instrumenterModule: unknown = await import(
    pathToFileURL(core.resolve('@stryker-mutator/instrumenter')).href
  );

  return pageHelpersFrom(instrumenterModule);
}

export async function pageHelpersFrom(
  instrumenterModule: unknown,
): Promise<string> {
  const Instrumenter = fieldOf(instrumenterModule, 'Instrumenter');

  if (typeof Instrumenter !== 'function') {
    throw new StrykerHelpersChanged('it exports no Instrumenter class');
  }

  const instrumenter: unknown = Reflect.construct(Instrumenter, [silentLog]);
  const instrument = fieldOf(instrumenter, 'instrument');

  if (typeof instrument !== 'function') {
    throw new StrykerHelpersChanged(
      'its Instrumenter has no instrument method',
    );
  }

  const result: unknown = await Reflect.apply(instrument, instrumenter, [
    [{ name: 'probe.js', content: `${probeName} = 1 + 1;`, mutate: true }],
    { plugins: null, excludedMutations: [], ignorers: [] },
  ]);
  const files = fieldOf(result, 'files');
  const content = fieldOf(
    Array.isArray(files) ? files[0] : undefined,
    'content',
  );

  if (typeof content !== 'string') {
    throw new StrykerHelpersChanged(
      'its Instrumenter returned no instrumented file',
    );
  }

  return pageHelpersScript(content);
}

export function pageHelpersScript(instrumented: string): string {
  const probeAt = instrumented.search(new RegExp(`^${probeName}\\b`, 'm'));

  if (probeAt < 0) {
    throw new StrykerHelpersChanged(
      `the instrumented probe has no probe statement: ${instrumented}`,
    );
  }

  const header = instrumented.slice(0, probeAt);
  const names = captured(header, /^function ([\w$]+)\(/gm);

  if (names.length === 0) {
    throw new StrykerHelpersChanged(
      `the header declares no helper function: ${instrumented}`,
    );
  }

  const undeclared = captured(instrumented.slice(probeAt), /([\w$]+)\(/g).find(
    (name) => !names.includes(name),
  );

  if (undeclared !== undefined) {
    throw new StrykerHelpersChanged(
      `the probe calls ${undeclared}, which the header does not declare`,
    );
  }

  return `${header}\nObject.assign(globalThis, { ${names.join(', ')} });`;
}
