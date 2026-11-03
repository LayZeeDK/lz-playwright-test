import path from 'node:path';

import { isRecord } from './is-record.ts';

export interface LzPlaywrightOptions {
  readonly configFile?: string;
  readonly projects?: readonly string[];
  readonly workers?: number;
  readonly retries?: number;
  readonly survivorTraces?: string;
}

type JsonType<T> = T extends string
  ? 'string'
  : T extends number
    ? 'integer'
    : T extends readonly string[]
      ? 'array'
      : never;

type OptionSchemas = {
  [K in keyof Required<LzPlaywrightOptions>]: {
    readonly type: JsonType<Required<LzPlaywrightOptions>[K]>;
    readonly description: string;
    readonly default?: Required<LzPlaywrightOptions>[K];
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
  retries: {
    type: 'integer',
    minimum: 0,
    description:
      'Retries of a failed test in every project. Defaults to the retries in the Playwright config.',
  },
  survivorTraces: {
    type: 'string',
    description:
      'Folder, relative to the project root, for the Playwright traces of surviving mutants. Records a trace of every test run; needs the lz-playwright-traces reporter.',
  },
} satisfies OptionSchemas;

export const strykerValidationSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  properties: {
    lzPlaywright: {
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
  readonly retries: number | undefined;
  readonly survivorTraces: string | undefined;
  readonly strykerTimeoutMS: number;
}

export interface LzPlaywrightRunnerOptionsWithStrykerOptions {
  readonly testFiles?: readonly string[];
  readonly timeoutMS: number;
  readonly lzPlaywright?: unknown;
}

const optionGuards = {
  configFile: (value) => value === undefined || typeof value === 'string',
  projects: (value) => value === undefined || isStringArray(value),
  workers: (value) => value === undefined || typeof value === 'number',
  retries: (value) => value === undefined || typeof value === 'number',
  survivorTraces: (value) => value === undefined || typeof value === 'string',
} satisfies {
  readonly [K in keyof LzPlaywrightOptions]-?: (
    value: unknown,
  ) => value is LzPlaywrightOptions[K];
};

export function readRunnerOptions(
  options: LzPlaywrightRunnerOptionsWithStrykerOptions,
): RunnerOptions {
  if (options.testFiles?.length) {
    throw new Error(
      'The Playwright test runner does not support the --testFiles option.',
    );
  }

  const own = options.lzPlaywright ?? {};

  if (isRecord(own) && !Array.isArray(own)) {
    const { configFile, projects, workers, retries, survivorTraces } = own;

    if (
      optionGuards.configFile(configFile) &&
      optionGuards.projects(projects) &&
      optionGuards.workers(workers) &&
      optionGuards.retries(retries) &&
      optionGuards.survivorTraces(survivorTraces)
    ) {
      const workerCount = workers ?? optionProperties.workers.default;

      if (
        Number.isInteger(workerCount) &&
        workerCount >= optionProperties.workers.minimum &&
        (retries === undefined ||
          (Number.isInteger(retries) &&
            retries >= optionProperties.retries.minimum))
      ) {
        return {
          configFile: configFile ? path.resolve(configFile) : undefined,
          projects,
          workers: workerCount,
          retries,
          survivorTraces,
          strykerTimeoutMS: options.timeoutMS,
        };
      }
    }
  }

  throw new Error(
    `The lzPlaywright options do not match their schema: ${JSON.stringify(own)}`,
  );
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === 'string')
  );
}
