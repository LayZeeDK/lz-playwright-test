import net from 'node:net';

import { isRecord } from './is-record.ts';
import type {
  ConfigHandles,
  ConfigProject,
  ConfigWebServer,
} from './playwright-internals.ts';
import { envOf, setEnv } from './process-env.ts';
import { hostKey } from './server-protocol.ts';
import { type ServerMutate, ServerSupportRefused } from './server-refusal.ts';

export interface ServerMove {
  readonly index: number;
  readonly from: number;
  readonly to: number;
}

export interface ServersApart {
  readonly moves: readonly ServerMove[];
  readonly webServers: readonly ConfigWebServer[];
  readonly baseURL: string | undefined;
  readonly env: Readonly<Record<string, string>>;
}

const baseUrlEnv = 'PLAYWRIGHT_TEST_BASE_URL';

export async function moveServersApart(
  config: {
    readonly projects: readonly ConfigProject[];
    readonly webServers: readonly ConfigWebServer[];
  },
  env: NodeJS.ProcessEnv,
  mutate: ServerMutate,
  nextPort: () => Promise<number> = freePort,
): Promise<ServersApart | undefined> {
  const planned = await Promise.all(
    config.webServers.map((server, index) => planMove(server, index, nextPort)),
  );
  const moves = planned.flatMap(({ move }) => (move ? [move] : []));
  const [first] = moves;

  if (!first) {
    return undefined;
  }

  const baseUrls = config.projects.flatMap(({ baseURL: url }) =>
    url === undefined ? [] : [url],
  );
  const movedUrl = (url: string): string | undefined => {
    const to = URL.canParse(url)
      ? moves.find(({ host }) => host === hostKey(new URL(url)))?.to
      : undefined;

    return to === undefined ? undefined : withPort(url, to);
  };
  const unmoved = baseUrls.filter((url) => movedUrl(url) === undefined);

  if (unmoved.length > 0) {
    throw cannotMove(
      mutate,
      `the baseURL ${unmoved.join(', ')} points at no webServer`,
    );
  }

  if (new Set(baseUrls.map((url) => hostKey(new URL(url)))).size > 1) {
    throw cannotMove(
      mutate,
      `the projects' baseURLs point at different webServers (${baseUrls.join(', ')})`,
    );
  }

  if (new Set(baseUrls.map(withHostKey)).size > 1) {
    throw cannotMove(
      mutate,
      `the projects' baseURLs differ in more than the loopback host name (${baseUrls.join(', ')})`,
    );
  }

  const [baseURL] = baseUrls;
  const testBaseUrl = env[baseUrlEnv];
  const movedTestBaseUrl =
    testBaseUrl === undefined ? undefined : movedUrl(testBaseUrl);

  return {
    moves: moves.map(({ index, from, to }) => ({ index, from, to })),
    webServers: planned.map(({ server }) => server),
    baseURL: baseURL === undefined ? undefined : movedUrl(baseURL),
    env: {
      ...(moves.length === 1 ? { PORT: String(first.to) } : {}),
      ...(movedTestBaseUrl === undefined
        ? {}
        : { [baseUrlEnv]: movedTestBaseUrl }),
    },
  };
}

async function planMove(
  server: ConfigWebServer,
  index: number,
  nextPort: () => Promise<number>,
) {
  const waitsFor =
    server.url ??
    (server.port === undefined ? undefined : `http://localhost:${server.port}`);

  if (waitsFor === undefined) {
    return { server, move: undefined };
  }

  const url = new URL(waitsFor);
  const to = await nextPort();

  return {
    server: {
      ...server,
      ...(server.url === undefined ? {} : { url: withPort(server.url, to) }),
      ...(server.port === undefined ? {} : { port: to }),
    },
    move: {
      index,
      from: Number(url.port || (url.protocol === 'https:' ? 443 : 80)),
      to,
      host: hostKey(url),
    },
  };
}

function cannotMove(
  mutate: ServerMutate,
  reason: string,
): ServerSupportRefused {
  return new ServerSupportRefused(
    mutate,
    'Stryker starts more than one test runner process, so each process ' +
      `needs a webServer port of its own, and the runner cannot move the projects' baseURL along: ${reason}. ` +
      'Point the baseURL of every project that runs at the url or port of the same webServer, or leave it unset, ' +
      'or run Stryker with concurrency 1 and no checker (see More than one Stryker process in the README).',
  );
}

function withHostKey(url: string): string {
  const keyed = new URL(url);
  keyed.host = hostKey(keyed);

  return keyed.href;
}

function withPort(url: string, port: number): string {
  const moved = new URL(url);
  moved.port = String(port);

  return moved.href;
}

export function moveApart(
  playwright: ConfigHandles,
  apart: ServersApart,
): () => void {
  const previousEnv = envOf(Object.keys(apart.env));
  moveWebServers(playwright, apart.moves, apart.baseURL);
  setEnv(apart.env);

  return () => {
    moveWebServers(
      playwright,
      apart.moves.map(({ index, from, to }) => ({
        index,
        from: to,
        to: from,
      })),
      undefined,
    );
    setEnv(previousEnv);
  };
}

export function moveWebServers(
  playwright: ConfigHandles,
  moves: readonly ServerMove[],
  baseURL: string | undefined,
): void {
  const overrides = playwright.cliOverrides();
  moves.forEach(({ index, from, to }) => {
    moveWebServerOptions(playwright.webServerOptions(index), from, to);
  });

  if (baseURL !== undefined) {
    const use = overrides['use'];
    overrides['use'] = { ...(isRecord(use) ? use : {}), baseURL };
  }
}

export function moveWebServerOptions(
  options: Record<string, unknown>,
  from: number,
  to: number,
): void {
  const { url, env, command } = options;

  if (typeof url === 'string') {
    options['url'] = withPort(url, to);
  }

  if (isRecord(env)) {
    Object.entries(env)
      .filter(([, value]) => value === from || value === String(from))
      .forEach(([name]) => {
        env[name] = String(to);
      });
  }

  if (typeof command === 'string') {
    options['command'] = command.replaceAll(
      new RegExp(`\\b${from}\\b`, 'g'),
      String(to),
    );
  }
}

// ponytail: another process may take the port before the webServer binds it; Playwright then reports the bind error.
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => {
        if (typeof address === 'object' && address !== null) {
          resolve(address.port);
        } else {
          reject(new Error(`Port 0 bound to ${String(address)}.`));
        }
      });
    });
  });
}

export function startsMoreRunners(
  options: {
    readonly concurrency?: number | string | undefined;
    readonly checkers?: readonly string[] | undefined;
  },
  parallelism: number,
): boolean {
  return (
    (options.checkers?.length ?? 0) > 0 ||
    concurrencyOf(options.concurrency, parallelism) > 1
  );
}

function concurrencyOf(
  option: number | string | undefined,
  parallelism: number,
): number {
  // Stryker's options schema admits only whole percentages from 0% to 100% as a string.
  if (typeof option === 'string') {
    return Math.round((parallelism * Number.parseInt(option, 10)) / 100);
  }

  if (typeof option === 'number') {
    return option;
  }

  // ponytail: Stryker's default takes one less above 4 cores, which is above 1 all the same.
  return parallelism;
}
