import { isRecord } from './is-record.ts';
import { packageName } from './package-name.ts';

export interface LzStorybookOptions {
  readonly configDir: string;
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
