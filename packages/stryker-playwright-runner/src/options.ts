import path from 'node:path';

import type { StrykerOptions } from '@stryker-mutator/api/core';

/** What a user writes under `playwright` in the Stryker config. */
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

// One schema entry per option with a JSON type that matches the TypeScript type, so the compiler fails
// when the interface and OPTION_PROPERTIES drift apart.
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

/** The options as the runner uses them: resolved, with the defaults applied. */
export interface RunnerOptions {
  /** Absolute; undefined lets Playwright find playwright.config.* in the working directory. */
  readonly configFile: string | undefined;
  readonly projects: string[] | undefined;
  readonly workers: number;
  readonly strykerTimeoutMS: number;
}

/**
 * The only reader of `StrykerOptions` for this runner. Stryker has validated the options against
 * `strykerValidationSchema`, so this only resolves them.
 */
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
