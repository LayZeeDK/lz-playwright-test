import net from 'node:net';

import type { ConfigWebServer, Playwright } from './playwright-internals.ts';

export interface ServerCheck {
  readonly name: string;
  isUp(): Promise<boolean>;
}

export type ServerTarget = { readonly port: number } | { readonly url: string };

export function serverTarget({
  url,
  port,
}: ConfigWebServer): ServerTarget | undefined {
  if (port !== undefined) {
    return { port };
  }

  return url === undefined ? undefined : { url };
}

export function serverCheck(
  server: ConfigWebServer,
  isURLAvailable: Playwright['isURLAvailable'],
): ServerCheck | undefined {
  const target = serverTarget(server);

  if (target === undefined) {
    return undefined;
  }

  if ('port' in target) {
    const { port } = target;

    return {
      name: server.url ?? `port ${port}`,
      isUp: () => acceptsConnections(port),
    };
  }

  const url = new URL(target.url);

  return {
    name: target.url,
    isUp: () => isURLAvailable(url, server.ignoreHTTPSErrors),
  };
}

// Playwright's own webServer port check tries both loopback addresses: localhost can resolve to only one of them.
const loopbackHosts = ['127.0.0.1', '::1'];

export interface ConnectingSocket {
  once(event: 'connect' | 'error' | 'timeout', listener: () => void): unknown;
  destroy(): unknown;
}

export function acceptsConnections(
  port: number,
  connect: (options: net.TcpNetConnectOpts) => ConnectingSocket = net.connect,
): Promise<boolean> {
  return new Promise((resolve) => {
    let answered = 0;

    loopbackHosts.forEach((host) => {
      const socket = connect({ host, port, timeout: 5000 });
      const done = (ok: boolean) => {
        socket.destroy();
        answered += 1;

        if (ok || answered === loopbackHosts.length) {
          resolve(ok);
        }
      };
      socket.once('connect', () => done(true));
      socket.once('error', () => done(false));
      socket.once('timeout', () => done(false));
    });
  });
}
