import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import type { schema } from '@stryker-mutator/api/core';
import type { Logger } from '@stryker-mutator/api/logging';
import { commonTokens, tokens } from '@stryker-mutator/api/plugin';
import type { Reporter } from '@stryker-mutator/api/report';

import {
  type LzPlaywrightRunnerOptionsWithStrykerOptions,
  readRunnerOptions,
} from './lz-playwright-runner-options-with-stryker-options.ts';
import {
  cleanTracesDir,
  projectRootEnv,
  tracesDirEnv,
} from './survivor-traces.ts';
import {
  describeSurvivors,
  indexHtml,
  readTraceFolders,
} from './traces-index.ts';

/**
 * Stryker builds reporters in its main process before it starts any test runner process, so the folder
 * is emptied, and its absolute path set in the environment the test runner processes inherit, before
 * any of them copies a trace.
 */
export class LzPlaywrightTracesReporter implements Reporter {
  static inject = tokens(commonTokens.options, commonTokens.logger);

  readonly #dir: string | undefined;
  readonly #log: Logger;

  constructor(
    options: LzPlaywrightRunnerOptionsWithStrykerOptions,
    log: Logger,
  ) {
    this.#log = log;
    const { survivorTraces } = readRunnerOptions(options);

    if (survivorTraces === undefined) {
      log.warn(
        'The lz-playwright-traces reporter does nothing without lzPlaywright.survivorTraces.',
      );

      return;
    }

    this.#dir = path.resolve(survivorTraces);
    const toProject = path.relative(this.#dir, process.cwd());

    if (!path.isAbsolute(toProject) && toProject.split(path.sep)[0] !== '..') {
      throw new Error(
        `lzPlaywright.survivorTraces is ${this.#dir}, which holds the project, and the lz-playwright-traces ` +
          'reporter empties that folder. Choose a folder inside the project, such as reports/lz-playwright-traces.',
      );
    }

    cleanTracesDir(this.#dir);
    process.env[tracesDirEnv] = this.#dir;
    process.env[projectRootEnv] = process.cwd();
    log.warn(
      'lzPlaywright.survivorTraces is set: every test run records a Playwright trace, which can change ' +
        "timing. Compare statuses with an untraced run's report before trusting them.",
    );
  }

  onMutationTestReportReady(report: schema.MutationTestResult): void {
    if (this.#dir === undefined) {
      return;
    }

    const { folders, unreadable } = readTraceFolders(this.#dir);

    if (unreadable.length > 0) {
      this.#log.warn(
        `Skipped trace folder(s) without a readable mutant.json: ${unreadable.join(', ')}`,
      );
    }

    const index = path.join(this.#dir, 'index.html');
    fs.writeFileSync(
      index,
      indexHtml(describeSurvivors(report, folders), strykerReportAppScript()),
    );
    this.#log.info(
      `Traces of ${folders.size} survivor(s): ${pathToFileURL(index).href}`,
    );
  }
}

function strykerReportAppScript(): string {
  const core = createRequire(
    createRequire(import.meta.url).resolve(
      '@stryker-mutator/core/package.json',
    ),
  );

  return fs.readFileSync(
    core.resolve('mutation-testing-elements/dist/mutation-test-elements.js'),
    'utf8',
  );
}
