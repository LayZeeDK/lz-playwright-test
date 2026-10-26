import path from 'node:path';

import type { StrykerOptions } from '@stryker-mutator/api/core';

export interface PlaywrightRunnerOptions {
  configFile?: string;
  projects?: string[];
  workers?: number;
}

type JsonType<T> = T extends string
  ? 'string'
  : T extends number
    ? 'integer'
    : T extends readonly string[]
      ? 'array'
      : never;

type OptionSchemas = {
  [K in keyof Required<PlaywrightRunnerOptions>]: {
    type: JsonType<Required<PlaywrightRunnerOptions>[K]>;
    description: string;
    default?: Required<PlaywrightRunnerOptions>[K];
    minimum?: number;
    items?: { type: 'string' };
  };
};

export const OPTION_PROPERTIES = {
  configFile: {
    type: 'string',
    description:
      'Path to the Playwright config file, relative to the project root.',
  },
  projects: {
    type: 'array',
    items: { type: 'string' },
    description:
      'Playwright projects to run. Defaults to the projects Playwright runs without --project, so not those with default: false.',
  },
  workers: {
    type: 'integer',
    minimum: 1,
    default: 1,
    description: 'Playwright workers per Stryker test runner process.',
  },
} satisfies OptionSchemas;

export const strykerValidationSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  properties: {
    playwright: {
      type: 'object',
      default: {},
      additionalProperties: false,
      properties: OPTION_PROPERTIES,
    },
  },
};

export interface RunnerOptions {
  readonly configFile: string | undefined;
  readonly projects: string[] | undefined;
  readonly workers: number;
  readonly strykerTimeoutMS: number;
}

export function readRunnerOptions(options: StrykerOptions): RunnerOptions {
  if (options.testFiles?.length) {
    throw new Error(
      'The Playwright test runner does not support the --testFiles option.',
    );
  }

  const own =
    (options as StrykerOptions & { playwright?: PlaywrightRunnerOptions })
      .playwright ?? {};

  return {
    configFile: own.configFile ? path.resolve(own.configFile) : undefined,
    projects: own.projects,
    workers: own.workers ?? OPTION_PROPERTIES.workers.default,
    strykerTimeoutMS: options.timeoutMS,
  };
}
