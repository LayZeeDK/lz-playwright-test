import { declareFactoryPlugin, PluginKind } from '@stryker-mutator/api/plugin';

import {
  consoleIgnorer,
  strykerValidationSchema as consoleSchema,
} from './console-ignorer.ts';
import { implicitRoles } from './implicit-roles.ts';
import { install } from './install.ts';
import { isRecord } from './is-record.ts';
import { mutatorsFor } from './mutators.ts';
import { packageName } from './package-name.ts';
import {
  strykerValidationSchema as stylingSchema,
  stylingIgnorer,
} from './styling-ignorer.ts';
import {
  telemetryIgnorer,
  strykerValidationSchema as telemetrySchema,
} from './telemetry-ignorer.ts';

/** Stryker reads one schema per plugin module, so it names the options of every ignorer here. */
export const strykerValidationSchema = {
  ...stylingSchema,
  properties: {
    ...stylingSchema.properties,
    ...telemetrySchema.properties,
    ...consoleSchema.properties,
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
  assertNoOptions(options);
  await install(mutatorsFor(implicitRoles));
}

function assertNoOptions(options: unknown): void {
  if (options === undefined) {
    return;
  }

  if (
    !isRecord(options) ||
    Array.isArray(options) ||
    Object.values(options).some((value) => value !== undefined)
  ) {
    throw new Error(
      `${packageName}: the package has no opt-in or experimental mutators yet, so lzJsxMutators() takes no ` +
        'options. Turn a mutator off with mutator.excludedMutations.',
    );
  }
}

export const strykerPlugins = [
  declareFactoryPlugin(PluginKind.Ignore, 'lz-jsx-styling', stylingIgnorer),
  declareFactoryPlugin(PluginKind.Ignore, 'lz-telemetry', telemetryIgnorer),
  declareFactoryPlugin(PluginKind.Ignore, 'lz-console', consoleIgnorer),
];
