import path from 'node:path';

import { isRecord } from './playwright-internals.ts';

export interface LzStrykerPlaywrightOptions {
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
  [K in keyof Required<LzStrykerPlaywrightOptions>]: {
    type: JsonType<Required<LzStrykerPlaywrightOptions>[K]>;
    description: string;
    default?: Required<LzStrykerPlaywrightOptions>[K];
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
    lzStrykerPlaywright: {
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

/** The Stryker options the runner reads. */
export interface RunnerStrykerOptions {
  readonly testFiles?: readonly string[];
  readonly timeoutMS: number;
  readonly lzStrykerPlaywright?: unknown;
}

export function readRunnerOptions(
  options: RunnerStrykerOptions,
): RunnerOptions {
  if (options.testFiles?.length) {
    throw new Error(
      'The Playwright test runner does not support the --testFiles option.',
    );
  }

  const own = options.lzStrykerPlaywright ?? {};

  if (isRecord(own)) {
    const {
      configFile,
      projects,
      workers = OPTION_PROPERTIES.workers.default,
    } = own;

    if (
      (configFile === undefined || typeof configFile === 'string') &&
      (projects === undefined || isStringArray(projects)) &&
      typeof workers === 'number'
    ) {
      return {
        configFile: configFile ? path.resolve(configFile) : undefined,
        projects,
        workers,
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
