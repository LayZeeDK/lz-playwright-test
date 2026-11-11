import { selectMutators } from '@layzee/stryker-mutator-install';
import { declareFactoryPlugin, PluginKind } from '@stryker-mutator/api/plugin';

import {
  consoleIgnorer,
  consoleIgnorerName,
  lzConsoleSchema,
} from './console-ignorer.ts';
import { implicitRoles } from './implicit-roles.ts';
import { install } from './install.ts';
import { mutatorsFor } from './mutators.ts';
import { packageName } from './package-name.ts';
import {
  lzJsxStylingSchema,
  stylingIgnorer,
  stylingIgnorerName,
} from './styling-ignorer.ts';
import {
  lzTelemetrySchema,
  telemetryIgnorer,
  telemetryIgnorerName,
} from './telemetry-ignorer.ts';

/**
 * Stryker reads one schema per plugin module, so it names the options of every ignorer here. Core merges its
 * `properties` into its own (meta-schema-builder.js:27).
 */
export const strykerValidationSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  properties: {
    lzJsxStyling: lzJsxStylingSchema,
    lzTelemetry: lzTelemetrySchema,
    lzConsole: lzConsoleSchema,
  },
};

/** This package has no opt-in or experimental mutators yet, so the options name none. */
export type LzJsxMutatorOptions = Readonly<Record<string, never>>;

/**
 * Installs this package's mutators into Stryker. A Stryker configuration file awaits it, so that an error in the install
 * stops the run; Stryker only warns when a module in `plugins` fails to load.
 */
export async function lzJsxMutators(
  options?: LzJsxMutatorOptions,
): Promise<void> {
  await install(
    selectMutators(
      packageName,
      'lzJsxMutators',
      { defaults: mutatorsFor(implicitRoles), optIn: [], experimental: [] },
      options,
    ),
  );
}

export const strykerPlugins = [
  declareFactoryPlugin(PluginKind.Ignore, stylingIgnorerName, stylingIgnorer),
  declareFactoryPlugin(
    PluginKind.Ignore,
    telemetryIgnorerName,
    telemetryIgnorer,
  ),
  declareFactoryPlugin(PluginKind.Ignore, consoleIgnorerName, consoleIgnorer),
];
