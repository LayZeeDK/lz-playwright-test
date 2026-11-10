import { isRecord } from './is-record.ts';
import { field } from './node-field.ts';
import { packageName } from './package-name.ts';

export interface LzStorybookOptions {
  readonly configDir: string;
}

export const playModes = ['ignore', 'mutate'] as const;

/** The `lzStorybookCsf` options of a Stryker config. */
export interface LzStorybookCsfOptions {
  readonly play?: (typeof playModes)[number];
}

/** Stryker's Vitest runner passes `vitest.configFile` to `createVitest` as `config` (vitest-test-runner.ts 207-208 at v10.1.1). */
export function vitestConfigFile(options: object): string | undefined {
  const configFile = field(options, 'vitest', 'configFile');

  return typeof configFile === 'string' ? configFile : undefined;
}

export function lzStorybookOptions(options: object): LzStorybookOptions {
  const lzStorybook: unknown = Reflect.get(options, 'lzStorybook');
  const configDir = isRecord(lzStorybook)
    ? lzStorybook['configDir']
    : undefined;

  if (configDir === undefined) {
    return { configDir: '.storybook' };
  }

  if (typeof configDir !== 'string') {
    throw new Error(
      `${packageName}: lzStorybook.configDir must be a string, not ${String(configDir)}`,
    );
  }

  return { configDir };
}
