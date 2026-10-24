import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { INSTRUMENTER_CONSTANTS } from '@stryker-mutator/api/core';
import { commonTokens } from '@stryker-mutator/api/plugin';
import {
  determineHitLimitReached,
  DryRunStatus,
  TestStatus,
  toMutantRunResult,
} from '@stryker-mutator/api/test-runner';

import testId from './test-id.cjs';

const HOOK = fileURLToPath(new URL('./worker-hook.cjs', import.meta.url));
const REPORTER = fileURLToPath(new URL('./reporter.cjs', import.meta.url));
const STATUS = { passed: TestStatus.Success, failed: TestStatus.Failed, skipped: TestStatus.Skipped };

let runCounter = 0;

export class PlaywrightTestRunner {
  static inject = [commonTokens.options, commonTokens.logger];

  constructor(options, log) {
    this.options = options.playwright ?? {};
    this.log = log;
  }

  capabilities() {
    return { reloadEnvironment: true };
  }

  async init() {
    this.configFile = this.options.configFile ? path.resolve(this.options.configFile) : undefined;
    this.cli = createRequire(this.configFile ?? path.resolve('package.json')).resolve('@playwright/test/cli');
  }

  async dryRun({ timeout, disableBail }) {
    const run = await this.run({ timeout, disableBail });

    if (run.status !== DryRunStatus.Complete) {
      return run;
    }

    return { ...run, mutantCoverage: mergeCoverage(run.snapshots) };
  }

  async mutantRun({ activeMutant, testFilter, hitLimit, timeout, disableBail }) {
    const run = await this.run({ activeMutant: activeMutant.id, testFilter, hitLimit, timeout, disableBail });
    const hitCount = run.snapshots?.reduce((sum, snapshot) => sum + (snapshot.hitCount ?? 0), 0);

    return toMutantRunResult(determineHitLimitReached(hitCount, hitLimit) ?? run);
  }

  async run({ activeMutant, testFilter, hitLimit, timeout, disableBail }) {
    const outDir = fs.mkdtempSync(
      path.join(os.tmpdir(), `stryker-pw-${process.env.STRYKER_MUTATOR_WORKER ?? 0}-${runCounter++}-`),
    );
    const reportFile = path.join(outDir, 'report.json');
    const args = [this.cli, 'test', '--reporter', REPORTER, '--retries=0', `--workers=${this.options.workers ?? 1}`];

    if (this.configFile) {
      args.push('--config', this.configFile);
    }

    if (!disableBail) {
      args.push('--max-failures=1');
    }

    const selection = selectTests(testFilter, this.options.projects);
    args.push(...selection.projects.map((project) => `--project=${project}`), ...selection.locations);

    const env = {
      ...process.env,
      NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --require "${HOOK.replaceAll('\\', '/')}"`.trim(),
      STRYKER_PW_OUT_DIR: outDir,
      STRYKER_PW_REPORT_FILE: reportFile,
      STRYKER_PW_NAMESPACE: INSTRUMENTER_CONSTANTS.NAMESPACE,
      PLAYWRIGHT_HTML_OPEN: 'never',
      FORCE_COLOR: '0',
    };
    delete env.__STRYKER_ACTIVE_MUTANT__;
    delete env.STRYKER_PW_HIT_LIMIT;

    if (activeMutant !== undefined) {
      env.__STRYKER_ACTIVE_MUTANT__ = activeMutant;
    }

    if (hitLimit !== undefined) {
      env.STRYKER_PW_HIT_LIMIT = String(hitLimit);
    }

    this.log.debug(`Running ${process.execPath} ${args.join(' ')}`);

    try {
      const exit = await runProcess(process.execPath, args, env, timeout);

      if (exit.timedOut) {
        return { status: DryRunStatus.Timeout, reason: `Playwright did not finish within ${timeout} ms` };
      }

      if (!fs.existsSync(reportFile)) {
        return { status: DryRunStatus.Error, errorMessage: `Playwright exited with ${exit.code}:\n${exit.output}` };
      }

      const report = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
      const tests = report.tests.map(toTestResult);

      if (report.errors.length && !tests.some((test) => test.status === TestStatus.Failed)) {
        return { status: DryRunStatus.Error, errorMessage: report.errors.join('\n') };
      }

      return { status: DryRunStatus.Complete, tests, snapshots: readSnapshots(outDir) };
    } finally {
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  }
}

function selectTests(testFilter, configuredProjects = []) {
  if (!testFilter) {
    return { projects: configuredProjects, locations: [] };
  }

  const parsed = testFilter.map(testId.parseTestId);

  return {
    projects: [...new Set(parsed.map((test) => test.project))],
    locations: [...new Set(parsed.map((test) => `${test.file}:${test.line}`))],
  };
}

function toTestResult(test) {
  const result = {
    id: test.id,
    name: test.id,
    status: STATUS[test.status],
    timeSpentMs: test.duration,
    fileName: test.file,
    startPosition: { line: test.line - 1, column: test.column - 1 },
  };

  if (result.status === TestStatus.Failed) {
    result.failureMessage = test.error ?? 'Test failed';
  }

  return result;
}

function readSnapshots(outDir) {
  return fs
    .readdirSync(outDir)
    .filter((file) => file.endsWith('.ndjson'))
    .flatMap((file) => fs.readFileSync(path.join(outDir, file), 'utf8').split('\n'))
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function mergeCoverage(snapshots) {
  const coverage = { static: {}, perTest: {} };
  const add = (target, hits = {}) => {
    for (const [mutantId, count] of Object.entries(hits)) {
      target[mutantId] = (target[mutantId] ?? 0) + count;
    }
  };

  for (const { mutantCoverage } of snapshots) {
    if (!mutantCoverage) {
      continue;
    }

    add(coverage.static, mutantCoverage.static);

    for (const [id, hits] of Object.entries(mutantCoverage.perTest ?? {})) {
      add((coverage.perTest[id] ??= {}), hits);
    }
  }

  return coverage;
}

function runProcess(command, args, env, timeout) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { env, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
    let output = '';
    const collect = (chunk) => {
      output = (output + chunk).slice(-8000);
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);

    const timer = setTimeout(() => {
      killTree(child);
      resolve({ timedOut: true, output });
    }, timeout);

    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, output });
    });
  });
}

function killTree(child) {
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    process.kill(-child.pid, 'SIGKILL');
  }
}
