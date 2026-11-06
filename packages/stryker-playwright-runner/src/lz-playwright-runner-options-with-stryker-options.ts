import path from 'node:path';

import { fieldOf, isRecord } from './is-record.ts';

export interface LzPlaywrightOptions {
  readonly configFile?: string;
  readonly projects?: readonly string[];
  readonly workers?: number;
  readonly retries?: number;
  readonly survivorTraces?: string;
  readonly traceScreenshots?: boolean;
}

type JsonType<T> = T extends string
  ? 'string'
  : T extends number
    ? 'integer'
    : T extends boolean
      ? 'boolean'
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

const scalarOptionProperties = {
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
      'Folder, relative to the folder you run Stryker from, for the Playwright traces of surviving mutants. Records a trace of every test run; needs the lz-playwright-traces reporter.',
  },
  traceScreenshots: {
    type: 'boolean',
    default: false,
    description:
      'Add screenshots to the traces that survivorTraces records. The trace viewer needs them to show canvas content; they can make a trace several times larger.',
  },
} satisfies OptionSchemas;

export const optionProperties = {
  ...scalarOptionProperties,
  webServer: {
    type: 'object',
    additionalProperties: false,
    properties: {
      mutate: { enum: [true, false, 'auto'] },
      isolate: { type: 'boolean' },
    },
    description:
      "Mutants in the code the Playwright config's webServer runs. mutate: true runs them, false (the default) leaves them NoCoverage; isolate (default true) keeps server mutant runs apart.",
  },
};

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
  readonly traceScreenshots: boolean;
  readonly webServer: WebServerOptions;
  readonly strykerTimeoutMS: number;
}

export interface WebServerOptions {
  readonly mutate: boolean | 'auto';
  readonly isolate: boolean;
}

export interface LzPlaywrightRunnerOptionsWithStrykerOptions {
  readonly testFiles?: readonly string[];
  readonly timeoutMS: number;
  readonly concurrency?: number | string | undefined;
  readonly checkers?: readonly string[] | undefined;
  readonly lzPlaywright?: unknown;
}

const optionGuards = {
  configFile: (value) => value === undefined || typeof value === 'string',
  projects: (value) => value === undefined || isStringArray(value),
  workers: (value) => value === undefined || typeof value === 'number',
  retries: (value) => value === undefined || typeof value === 'number',
  survivorTraces: (value) => value === undefined || typeof value === 'string',
  traceScreenshots: (value) =>
    value === undefined || typeof value === 'boolean',
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
    const {
      configFile,
      projects,
      workers,
      retries,
      survivorTraces,
      traceScreenshots,
      webServer,
    } = own;

    if (
      optionGuards.configFile(configFile) &&
      optionGuards.projects(projects) &&
      optionGuards.workers(workers) &&
      optionGuards.retries(retries) &&
      optionGuards.survivorTraces(survivorTraces) &&
      optionGuards.traceScreenshots(traceScreenshots)
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
          traceScreenshots:
            traceScreenshots ?? optionProperties.traceScreenshots.default,
          webServer: readWebServer(webServer),
          strykerTimeoutMS: options.timeoutMS,
        };
      }
    }
  }

  throw new Error(
    `The lzPlaywright options do not match their schema: ${JSON.stringify(own)}`,
  );
}

function readWebServer(value: unknown): WebServerOptions {
  const knownKeys = Object.keys(optionProperties.webServer.properties);
  const knownList = knownKeys.join(' and ');

  if (value !== undefined && (!isRecord(value) || Array.isArray(value))) {
    throw new Error(
      `lzPlaywright.webServer must be an object with ${knownList}, got ${JSON.stringify(value)}.`,
    );
  }

  const unknownKey = (isRecord(value) ? Object.keys(value) : []).find(
    (key) => !knownKeys.includes(key),
  );

  if (unknownKey !== undefined) {
    throw new Error(
      `lzPlaywright.webServer has no option ${unknownKey}; it takes ${knownList}.`,
    );
  }

  const mutate = fieldOf(value, 'mutate');

  if (
    mutate !== undefined &&
    mutate !== true &&
    mutate !== false &&
    mutate !== 'auto'
  ) {
    throw new Error(
      `lzPlaywright.webServer.mutate must be true, false or 'auto', got ${JSON.stringify(mutate)}.`,
    );
  }

  const isolate = fieldOf(value, 'isolate');

  if (isolate !== undefined && typeof isolate !== 'boolean') {
    throw new Error(
      `lzPlaywright.webServer.isolate must be true or false, got ${JSON.stringify(isolate)}.`,
    );
  }

  return {
    mutate: mutate ?? false,
    isolate: isolate ?? true,
  };
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === 'string')
  );
}
