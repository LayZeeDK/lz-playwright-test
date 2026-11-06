import net from 'node:net';

import type {
  ConfigProject,
  ConfigWebServer,
  ServerMove,
} from './playwright-internals.ts';
import { hostKey, ServerSupportRefused } from './server-protocol.ts';

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
  nextPort: () => Promise<number> = freePort,
): Promise<ServersApart | undefined> {
  const planned = await Promise.all(
    config.webServers.map((server, index) =>
      planMove(server, index, nextPort),
    ),
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
      `the baseURL ${unmoved.join(', ')} points at no webServer`,
    );
  }

  if (new Set(baseUrls.map((url) => hostKey(new URL(url)))).size > 1) {
    throw cannotMove(
      `the projects' baseURLs point at different webServers (${baseUrls.join(', ')})`,
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

function cannotMove(reason: string): ServerSupportRefused {
  return new ServerSupportRefused(
    ' and Stryker starts more than one test runner process, so each process ' +
      `needs a webServer port of its own, but the runner cannot move the projects' baseURL along: ${reason}. ` +
      'Derive the port from STRYKER_MUTATOR_WORKER in the Playwright config instead (see Configure in the README).',
  );
}

function withPort(url: string, port: number): string {
  const moved = new URL(url);
  moved.port = String(port);

  return moved.href;
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
  const percentage =
    typeof option === 'string'
      ? /^(100|[1-9]?[0-9])%$/.exec(option)?.[1]
      : undefined;

  if (percentage !== undefined) {
    return Math.round((parallelism * Number(percentage)) / 100);
  }

  if (typeof option === 'number') {
    return option;
  }

  // ponytail: Stryker's default takes one less above 4 cores, which is above 1 all the same.
  return parallelism;
}
