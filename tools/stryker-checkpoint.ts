// Stryker saves incrementalFile only when a run ends or on a signal (SIGINT and others); TerminateProcess on
// Windows sends no signal, so this reporter checkpoints the file during the run. Stryker overwrites it with the
// full report at the end. Mutants reused from earlier runs (outside --mutate) arrive through onMutantTested as
// early results, so the checkpoint keeps them.
// Run: stryker run <config> --incremental --appendPlugins <this file> --reporters <the config's reporters>,lz-checkpoint
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';

import type {
  MutantResult,
  schema,
  StrykerOptions,
} from '@stryker-mutator/api/core';
import type { Logger } from '@stryker-mutator/api/logging';
import {
  commonTokens,
  declareClassPlugin,
  PluginKind,
  tokens,
} from '@stryker-mutator/api/plugin';
import type {
  DryRunCompletedEvent,
  Reporter,
} from '@stryker-mutator/api/report';
import type { TestResult } from '@stryker-mutator/api/test-runner';

export interface CheckpointDeps {
  readonly cwd: string;
  readonly now: () => number;
  /** Runs `callback` after `ms` milliseconds; the returned function cancels it. */
  readonly schedule: (callback: () => void, ms: number) => () => void;
  readonly readSource: (file: string) => string | undefined;
}

function defaultDeps(backupRoot: string | undefined): CheckpointDeps {
  const cwd = process.cwd();
  const sources = new Map<string, string | undefined>();

  return {
    cwd,
    now: () => Date.now(),
    schedule: (callback, ms) => {
      const timer = setTimeout(callback, ms);

      timer.unref();

      return () => {
        clearTimeout(timer);
      };
    },
    readSource: (file) => {
      if (!sources.has(file)) {
        sources.set(file, originalSource(file, cwd, backupRoot));
      }

      return sources.get(file);
    },
  };
}

/**
 * In place, Stryker overwrites the files it mutates or marks `@ts-nocheck` and keeps their originals under
 * `<tempDirName>/backup-<id>/`; a checkpoint with the changed text makes the next run see every file as changed
 * and reuse nothing.
 */
export function originalSource(
  file: string,
  cwd: string,
  backupRoot: string | undefined,
): string | undefined {
  const backup =
    backupRoot === undefined ? undefined : newestBackup(backupRoot);

  return (
    (backup === undefined
      ? undefined
      : readText(join(backup, relative(cwd, file)))) ?? readText(file)
  );
}

function newestBackup(backupRoot: string): string | undefined {
  try {
    return readdirSync(backupRoot)
      .filter((name) => name.startsWith('backup-'))
      .map((name) => {
        const path = join(backupRoot, name);

        return { path, mtimeMs: statSync(path).mtimeMs };
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs)[0]?.path;
  } catch {
    return undefined;
  }
}

function readText(file: string): string | undefined {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return undefined;
  }
}

export class CheckpointReporter implements Reporter {
  static inject = tokens(commonTokens.options, commonTokens.logger);
  readonly #file: string;
  readonly #log: Pick<Logger, 'warn'>;
  readonly #deps: CheckpointDeps;
  readonly #intervalMs: number;
  readonly #mutants: Readonly<MutantResult>[] = [];
  #tests: readonly TestResult[] = [];
  #lastWrite: number;
  #cancelPending: (() => void) | undefined;
  #reportReady = false;

  constructor(
    {
      incrementalFile,
      inPlace,
      tempDirName,
    }: Pick<StrykerOptions, 'incrementalFile' | 'inPlace' | 'tempDirName'>,
    log: Pick<Logger, 'warn'>,
    deps: CheckpointDeps = defaultDeps(
      inPlace ? resolve(tempDirName) : undefined,
    ),
    intervalMs = 5_000,
  ) {
    this.#file = incrementalFile;
    this.#log = log;
    this.#deps = deps;
    this.#intervalMs = intervalMs;
    this.#lastWrite = deps.now();
  }

  onDryRunCompleted({ result }: DryRunCompletedEvent): void {
    this.#tests = result.tests;
  }

  onMutantTested(result: Readonly<MutantResult>): void {
    this.#mutants.push(result);

    if (this.#reportReady || this.#cancelPending !== undefined) {
      return;
    }

    const wait = this.#intervalMs - (this.#deps.now() - this.#lastWrite);

    this.#cancelPending = this.#deps.schedule(
      () => {
        this.#cancelPending = undefined;
        this.#checkpoint();
      },
      Math.max(0, wait),
    );
  }

  /** Stryker writes its own incrementalFile right after this, which a later checkpoint must not overwrite. */
  onMutationTestReportReady(): void {
    this.#reportReady = true;
    this.#cancelPending?.();
    this.#cancelPending = undefined;
  }

  #checkpoint(): void {
    this.#lastWrite = this.#deps.now();

    try {
      this.#replaceAtomically();
    } catch (error) {
      this.#log.warn(
        `Could not write the checkpoint to ${this.#file}: ${String(error)}`,
      );
    }
  }

  #replaceAtomically(): void {
    const { cwd, readSource } = this.#deps;
    const temporary = `${this.#file}.tmp`;

    mkdirSync(dirname(this.#file), { recursive: true });
    writeFileSync(
      temporary,
      JSON.stringify(
        checkpointReport(this.#mutants, this.#tests, cwd, readSource),
      ),
    );
    renameSync(temporary, this.#file);
  }
}

export const strykerPlugins = [
  declareClassPlugin(PluginKind.Reporter, 'lz-checkpoint', CheckpointReporter),
];

export function checkpointReport(
  mutants: readonly Readonly<MutantResult>[],
  tests: readonly TestResult[],
  cwd: string,
  readSource: (file: string) => string | undefined,
): schema.MutationTestResult {
  const files: Record<string, schema.FileResult> = {};
  const testFiles: Record<string, schema.TestFile> = {};

  mutants.forEach(({ fileName, ...mutant }) => {
    const file = (files[reportName(cwd, fileName)] ??= {
      language: languageOf(fileName),
      source: readSource(fileName) ?? '',
      mutants: [],
    });

    file.mutants.push(mutant);
  });
  tests.forEach(({ id, name, fileName, startPosition }) => {
    const file = (testFiles[
      fileName === undefined ? '' : reportName(cwd, fileName)
    ] ??= testFile(fileName, readSource));

    file.tests.push({
      id,
      name,
      ...(startPosition === undefined
        ? {}
        : {
            location: {
              start: {
                line: startPosition.line + 1,
                column: startPosition.column + 1,
              },
            },
          }),
    });
  });

  return {
    schemaVersion: '1.0',
    thresholds: { high: 80, low: 60 },
    files,
    testFiles,
  };
}

function testFile(
  fileName: string | undefined,
  readSource: (file: string) => string | undefined,
): schema.TestFile {
  const source = fileName === undefined ? undefined : readSource(fileName);

  return source === undefined ? { tests: [] } : { source, tests: [] };
}

function languageOf(fileName: string): string {
  return ['.ts', '.tsx', '.mts', '.cts'].includes(extname(fileName))
    ? 'typescript'
    : 'javascript';
}

function reportName(cwd: string, file: string): string {
  return relative(cwd, file).split(sep).join('/');
}
