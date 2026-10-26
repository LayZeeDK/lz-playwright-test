// The package's only entry. Two routes import it: core's plugin loader (`plugins`) and a JS/TS config's first line.
import type { Ignorer } from '@stryker-mutator/api/ignore';
import { declareFactoryPlugin, PluginKind } from '@stryker-mutator/api/plugin';

import { install } from './install.ts';
import { operators } from './operators.ts';

// Core sets this in every test-runner and checker child process (child-process-proxy.js:32), which re-import plugin
// modules but never instrument. A Stryker run started inside such a process inherits it; the ignorer then refuses.
const installRan = process.env.STRYKER_MUTATOR_WORKER === undefined;

if (installRan) {
  // A failure rejects this module's evaluation, and every later import of it rejects with the same error. A config
  // that imports it stops at once; under `plugins`, core only warns with the message, and the run then stops where
  // core creates the `ui-mutators` ignorer this module never got to export.
  await install(operators);
}

function uiMutatorsIgnorer(): Ignorer {
  if (!installRan) {
    throw new Error(
      'stryker-ui-mutators: the install did not run, because STRYKER_MUTATOR_WORKER is set in a process that ' +
        'instruments. Unset it for the Stryker run.',
    );
  }

  return { shouldIgnore: () => undefined };
}
uiMutatorsIgnorer.inject = [] as const;

export const strykerPlugins = [
  declareFactoryPlugin(PluginKind.Ignore, 'ui-mutators', uiMutatorsIgnorer),
];
