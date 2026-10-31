import path from 'node:path';

import { isRecord } from './is-record.ts';

export interface LzStrykerPlaywrightOptions {
  readonly configFile?: string;
  readonly projects?: readonly string[];
  readonly workers?: number;
}

type JsonType<T> = T extends string
  ? 'string'
  : T extends number
    ? 'integer'
    : T extends readonly string[]
      ? 'array'
      : never;

type OptionSchemas = {
  [K in keyof Required<LzStrykerPlaywrightOptions>]: {
    readonly type: JsonType<Required<LzStrykerPlaywrightOptions>[K]>;
    readonly description: string;
    readonly default?: Required<LzStrykerPlaywrightOptions>[K];
    readonly minimum?: number;
    readonly items?: { readonly type: 'string' };
  };
};

export const optionProperties = {
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
    lzStrykerPlaywright: {
      type: 'object',
      default: {},
      additionalProperties: false,
      properties: optionProperties,
    },
  },
};

export interface RunnerOptions {
  readonly configFile: string | undefined;
  readonly projects: readonly string[] | undefined;
  readonly workers: number;
  readonly strykerTimeoutMS: number;
}

export interface RunnerStrykerOptions {
  readonly testFiles?: readonly string[];
  readonly timeoutMS: number;
  readonly lzStrykerPlaywright?: unknown;
}

const optionGuards = {
  configFile: (value) => value === undefined || typeof value === 'string',
  projects: (value) => value === undefined || isStringArray(value),
  workers: (value) => value === undefined || typeof value === 'number',
} satisfies {
  readonly [K in keyof LzStrykerPlaywrightOptions]-?: (
    value: unknown,
  ) => value is LzStrykerPlaywrightOptions[K];
};

export function readRunnerOptions(
  options: RunnerStrykerOptions,
): RunnerOptions {
  if (options.testFiles?.length) {
    throw new Error(
      'The Playwright test runner does not support the --testFiles option.',
    );
  }

  const own = options.lzStrykerPlaywright ?? {};

  if (isRecord(own) && !Array.isArray(own)) {
    const { configFile, projects, workers } = own;

    if (
      optionGuards.configFile(configFile) &&
      optionGuards.projects(projects) &&
      optionGuards.workers(workers)
    ) {
      return {
        configFile: configFile ? path.resolve(configFile) : undefined,
        projects,
        workers: workers ?? optionProperties.workers.default,
        strykerTimeoutMS: options.timeoutMS,
      };
    }
  }

  throw new Error(
    `The lzStrykerPlaywright options do not match their schema: ${JSON.stringify(own)}`,
  );
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === 'string')
  );
}
