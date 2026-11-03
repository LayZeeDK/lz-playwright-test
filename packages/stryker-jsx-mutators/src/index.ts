import type { Ignorer } from '@stryker-mutator/api/ignore';
import { declareFactoryPlugin, PluginKind } from '@stryker-mutator/api/plugin';

import { implicitRoles } from './implicit-roles.ts';
import { install } from './install.ts';
import { mutatorsFor } from './mutators.ts';
import { packageName } from './package-name.ts';

// Core sets this in every test-runner and checker child process (child-process-proxy.js:32), which re-import plugin
// modules but never instrument.
const installRan = process.env['STRYKER_MUTATOR_WORKER'] === undefined;

if (installRan) {
  // A failure rejects this module's evaluation, and every later import of it rejects with the same error. A config
  // that imports it stops at once; under `plugins`, core only warns with the message, and the run then stops where
  // core creates the ignorer this module never got to export.
  await install(mutatorsFor(implicitRoles));
}

function uiMutatorsIgnorer(): Ignorer {
  if (!installRan) {
    throw new Error(
      `${packageName}: the install did not run, because STRYKER_MUTATOR_WORKER is set in a process that ` +
        'instruments. Unset it for the Stryker run.',
    );
  }

  return { shouldIgnore: () => undefined };
}
uiMutatorsIgnorer.inject = [] satisfies [];

export const strykerPlugins = [
  declareFactoryPlugin(PluginKind.Ignore, 'lz-jsx', uiMutatorsIgnorer),
];
