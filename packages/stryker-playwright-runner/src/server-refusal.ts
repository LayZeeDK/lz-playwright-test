import type { WebServerOptions } from './lz-playwright-runner-options-with-stryker-options.ts';

export const mutateOption = 'lzPlaywright.webServer.mutate';

export type ServerMutate = Exclude<WebServerOptions['mutate'], false>;

function describeRefusal(mutate: ServerMutate, reason: string): string {
  return `${mutateOption} is ${mutate === 'auto' ? "'auto'" : 'true'}, but ${reason}`;
}

export class ServerSupportRefused extends Error {
  constructor(mutate: ServerMutate, reason: string, options?: ErrorOptions) {
    super(describeRefusal(mutate, reason), options);
  }
}
