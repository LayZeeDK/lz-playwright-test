import { writeFileSync } from 'node:fs';
import path from 'node:path';
import type { TestContext } from 'node:test';

import { serializeSnapshot } from '../../src/protocol.ts';
import {
  hookedPrefix,
  readServerControl,
  type ServerControl,
  serverDirEnv,
} from '../../src/server-protocol.ts';
import { mutantRunOptions, tempTree } from './doubles.ts';
import {
  activeMutantEnv,
  type Behaviour,
  fakePlaywright,
  passAll,
  type Run,
  stubEnv,
} from './fake-playwright.ts';

export const serverHookUrl = new URL(
  '../../src/server-hook.ts',
  import.meta.url,
).href;
// A url, not a port: the fake answers the url check, and a port check would connect for real.
export const webServer = { url: 'http://127.0.0.1:4820/' };
export const autoOff =
  ' Server-side mutants stay NoCoverage in this run; lzPlaywright.webServer.mutate: true makes this an error instead.';

interface Setup {
  readonly nodeOptions: string | undefined;
  readonly serverDir: string | undefined;
  readonly activeMutant: string | undefined;
}

/** Stryker starts each test runner process in its sandbox folder. */
export function inSandbox(t: TestContext): string {
  const cwd = process.cwd();
  t.after(() => process.chdir(cwd));
  const sandbox = tempTree(t, 'sandbox-');
  process.chdir(sandbox);

  return sandbox;
}

export function serverFake(
  t: TestContext,
  {
    hooked = true,
    ...behaviour
  }: Behaviour & { readonly hooked?: boolean | (() => boolean) } = {},
) {
  stubEnv(t, { NODE_OPTIONS: '--no-warnings' });
  const sandbox = inSandbox(t);
  const setups: Setup[] = [];
  const controls: (ServerControl | undefined)[] = [];
  const fake = fakePlaywright(t, {
    ...behaviour,
    webServers: behaviour.webServers ?? [webServer],
    globalSetup: (reporter) => {
      const serverDir = process.env[serverDirEnv];
      setups.push({
        nodeOptions: process.env['NODE_OPTIONS'],
        serverDir,
        activeMutant: process.env[activeMutantEnv],
      });

      if (
        (typeof hooked === 'function' ? hooked() : hooked) &&
        serverDir !== undefined
      ) {
        writeFileSync(path.join(serverDir, `${hookedPrefix}1`), '');
      }

      return behaviour.globalSetup?.(reporter) ?? 'passed';
    },
    runTests: async (run: Run) => {
      const serverDir = setups.at(-1)?.serverDir;
      controls.push(
        serverDir === undefined ? undefined : readServerControl(serverDir),
      );

      return (behaviour.runTests ?? passAll)(run);
    },
  });

  return {
    ...fake,
    runner: ({
      isolate,
      mutate = true,
      projects,
      ...strykerOptions
    }: {
      readonly isolate?: boolean;
      readonly mutate?: true | 'auto';
      readonly projects?: readonly string[];
      readonly timeoutMS?: number;
      readonly concurrency?: number;
      readonly checkers?: readonly string[];
    } = {}) =>
      fake.runner({
        ...strykerOptions,
        lzPlaywright: {
          ...(projects === undefined ? {} : { projects }),
          webServer: {
            mutate,
            ...(isolate === undefined ? {} : { isolate }),
          },
        },
      }),
    setups,
    controls,
    sandbox,
  };
}

export function runtimeRun(id: string) {
  return mutantRunOptions({
    activeMutant: { ...mutantRunOptions().activeMutant, id },
    mutantActivation: 'runtime',
    testFilter: ['a'],
  });
}

export function passAllWithDryRunServerMutants(...ids: readonly string[]) {
  return async (run: Run) => {
    await passAll(run);

    if (run.settings.perTest) {
      writeFileSync(
        path.join(run.settings.outDir, 'server-9-x.ndjson'),
        serializeSnapshot({
          mutantCoverage: {
            static: {},
            perTest: { a: Object.fromEntries(ids.map((id) => [id, 1])) },
          },
          outlivedItsTest: false,
        }) + '\n',
      );
    }

    return 'passed' as const;
  };
}
