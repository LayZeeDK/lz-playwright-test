// Run: node --test tools/stryker-checkpoint.test.ts
import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, type TestContext } from 'node:test';

import type { MutantResult } from '@stryker-mutator/api/core';
import {
  DryRunStatus,
  TestStatus,
  type TestResult,
} from '@stryker-mutator/api/test-runner';

import {
  checkpointReport,
  CheckpointReporter,
  originalSource,
} from './stryker-checkpoint.ts';

const options = { inPlace: false, tempDirName: '.stryker-tmp' };

const root = join(tmpdir(), 'project');

function mutant(
  file: string,
  id: string,
  overrides: Partial<MutantResult> = {},
): MutantResult {
  return {
    id,
    fileName: join(root, file),
    mutatorName: 'BooleanLiteral',
    replacement: 'false',
    location: { start: { line: 2, column: 5 }, end: { line: 2, column: 9 } },
    status: 'Killed',
    killedBy: ['t1'],
    coveredBy: ['t1'],
    ...overrides,
  };
}

function testResult(id: string, fileName: string | undefined): TestResult {
  return {
    id,
    name: `test ${id}`,
    timeSpentMs: 1,
    status: TestStatus.Success,
    ...(fileName === undefined
      ? {}
      : {
          fileName: join(root, fileName),
          startPosition: { line: 3, column: 0 },
        }),
  };
}

function sources(file: string): string {
  return `source of ${file.slice(root.length + 1).replaceAll('\\', '/')}`;
}

function mutantCount(file: string): number {
  const report: unknown = JSON.parse(readFileSync(file, 'utf8'));

  assert.ok(typeof report === 'object' && report !== null && 'files' in report);
  assert.ok(typeof report.files === 'object' && report.files !== null);

  return Object.values(report.files).reduce<number>((count, entry: unknown) => {
    assert.ok(
      typeof entry === 'object' &&
        entry !== null &&
        'mutants' in entry &&
        Array.isArray(entry.mutants),
    );

    return count + entry.mutants.length;
  }, 0);
}

describe('checkpointReport', () => {
  it('groups the tested mutants by their file relative to the root, with its source and no fileName', () => {
    const report = checkpointReport(
      [
        mutant('lib/a.js', '1'),
        mutant('index.js', '2'),
        mutant('lib/a.js', '3', { status: 'Survived' }),
      ],
      [],
      root,
      sources,
    );

    const { 'lib/a.js': lib, 'index.js': index } = report.files;

    assert.ok(lib);
    assert.deepEqual(Object.keys(report.files), ['lib/a.js', 'index.js']);
    assert.equal(lib.source, 'source of lib/a.js');
    assert.equal(lib.language, 'javascript');
    assert.deepEqual(
      lib.mutants.map(({ id, status }) => `${id} ${status}`),
      ['1 Killed', '3 Survived'],
    );
    assert.equal('fileName' in (index?.mutants[0] ?? {}), false);
  });

  it("lists the dry run's tests by file with 1-based start positions, and tests without a file under ''", () => {
    const report = checkpointReport(
      [],
      [testResult('t1', 'test/a.test.js'), testResult('t2', undefined)],
      root,
      sources,
    );

    assert.deepEqual(report.testFiles, {
      'test/a.test.js': {
        source: 'source of test/a.test.js',
        tests: [
          {
            id: 't1',
            name: 'test t1',
            location: { start: { line: 4, column: 1 } },
          },
        ],
      },
      '': { tests: [{ id: 't2', name: 'test t2' }] },
    });
  });

  it("leaves out a test file's source it cannot read, and gives a mutated file it cannot read an empty one, as Stryker does", () => {
    const report = checkpointReport(
      [mutant('index.js', '1')],
      [testResult('t1', 'test/a.test.js')],
      root,
      () => undefined,
    );

    assert.equal(report.files['index.js']?.source, '');
    assert.deepEqual(report.testFiles?.['test/a.test.js'], {
      tests: [
        {
          id: 't1',
          name: 'test t1',
          location: { start: { line: 4, column: 1 } },
        },
      ],
    });
  });

  it('marks a TypeScript or TSX file as typescript', () => {
    const report = checkpointReport(
      [mutant('src/a.ts', '1'), mutant('src/b.tsx', '2')],
      [],
      root,
      sources,
    );

    assert.equal(report.files['src/a.ts']?.language, 'typescript');
    assert.equal(report.files['src/b.tsx']?.language, 'typescript');
  });
});

function setup(t: TestContext): string {
  const dir = mkdtempSync(join(tmpdir(), 'stryker-checkpoint-'));

  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  return dir;
}

describe('originalSource', () => {
  function project(t: TestContext): {
    readonly cwd: string;
    readonly file: string;
    readonly backup: (name: string, text: string, mtimeSeconds: number) => void;
  } {
    const cwd = setup(t);
    const file = join(cwd, 'src', 'a.ts');

    mkdirSync(join(cwd, 'src'));
    writeFileSync(file, '// @ts-nocheck\nmutated');

    return {
      cwd,
      file,
      backup: (name, text, mtimeSeconds) => {
        const dir = join(cwd, '.stryker-tmp', name);

        mkdirSync(join(dir, 'src'), { recursive: true });
        writeFileSync(join(dir, 'src', 'a.ts'), text);
        utimesSync(dir, mtimeSeconds, mtimeSeconds);
      },
    };
  }

  it("reads a file's original from the newest in-place backup", (t) => {
    const { cwd, file, backup } = project(t);

    backup('backup-old', 'stale', 1_000);
    backup('backup-new', 'original', 2_000);

    assert.equal(
      originalSource(file, cwd, join(cwd, '.stryker-tmp')),
      'original',
    );
  });

  it('reads the file itself when the newest backup does not hold it, or the run is not in place', (t) => {
    const { cwd, file } = project(t);

    mkdirSync(join(cwd, '.stryker-tmp', 'backup-only-others'), {
      recursive: true,
    });

    assert.equal(
      originalSource(file, cwd, join(cwd, '.stryker-tmp')),
      '// @ts-nocheck\nmutated',
    );
    assert.equal(
      originalSource(file, cwd, undefined),
      '// @ts-nocheck\nmutated',
    );
  });

  it('reads the file itself when there is no backup folder yet', (t) => {
    const { cwd, file } = project(t);

    assert.equal(
      originalSource(file, cwd, join(cwd, '.stryker-tmp')),
      '// @ts-nocheck\nmutated',
    );
  });
});

describe('CheckpointReporter', () => {
  function checkpoint(file: string) {
    const clock = { now: 0 };
    const pending: { callback: () => void; ms: number }[] = [];
    const warnings: string[] = [];
    const reporter = new CheckpointReporter(
      { ...options, incrementalFile: file },
      { warn: (message: string) => warnings.push(message) },
      {
        cwd: root,
        now: () => clock.now,
        schedule: (callback, ms) => {
          const entry = { callback, ms };

          pending.push(entry);

          return () => {
            pending.splice(pending.indexOf(entry), 1);
          };
        },
        readSource: sources,
      },
      5_000,
    );

    return {
      reporter,
      clock,
      pending,
      warnings,
      fire: () => {
        const entry = pending.shift();

        assert.ok(entry);
        entry.callback();
      },
    };
  }

  it('writes every mutant that arrives before a scheduled write, the interval after its last write', (t) => {
    const file = join(setup(t), 'stryker-incremental.json');
    const { reporter, clock, pending, fire } = checkpoint(file);

    reporter.onDryRunCompleted({
      result: {
        status: DryRunStatus.Complete,
        tests: [testResult('t1', 'test/a.test.js')],
      },
      timing: { net: 0, overhead: 0 },
      capabilities: { reloadEnvironment: true },
    });
    clock.now = 60_000;
    reporter.onMutantTested(mutant('index.js', '1'));
    reporter.onMutantTested(mutant('index.js', '2'));
    reporter.onMutantTested(mutant('index.js', '3'));
    assert.deepEqual(
      pending.map(({ ms }) => ms),
      [0],
    );
    assert.throws(() => readFileSync(file), { code: 'ENOENT' });

    fire();
    assert.equal(mutantCount(file), 3);
    assert.match(readFileSync(file, 'utf8'), /"test\/a\.test\.js"/);

    clock.now = 62_000;
    reporter.onMutantTested(mutant('index.js', '4'));
    assert.deepEqual(
      pending.map(({ ms }) => ms),
      [3_000],
    );

    fire();
    assert.equal(mutantCount(file), 4);
  });

  it("writes nothing once Stryker's report is ready, since Stryker then writes the file itself", (t) => {
    const file = join(setup(t), 'stryker-incremental.json');
    const { reporter, pending } = checkpoint(file);

    reporter.onMutantTested(mutant('index.js', '1'));
    reporter.onMutationTestReportReady();
    reporter.onMutantTested(mutant('index.js', '2'));

    assert.deepEqual(pending, []);
  });

  it('replaces an existing file and leaves no temporary file beside it', (t) => {
    const dir = setup(t);
    const file = join(dir, 'stryker-incremental.json');

    writeFileSync(file, 'earlier');
    const { reporter, fire } = checkpoint(file);

    reporter.onMutantTested(mutant('index.js', '1'));
    fire();

    assert.equal(mutantCount(file), 1);
    assert.deepEqual(readdirSync(dir), ['stryker-incremental.json']);
  });

  it("creates the file's folder", (t) => {
    const file = join(setup(t), 'reports', 'stryker-incremental.json');
    const { reporter, fire } = checkpoint(file);

    reporter.onMutantTested(mutant('index.js', '1'));
    fire();

    assert.equal(mutantCount(file), 1);
  });

  it('logs a write that fails instead of throwing into the run', (t) => {
    const dir = setup(t);

    writeFileSync(join(dir, 'reports'), 'a file, not a folder');
    const { reporter, warnings, fire } = checkpoint(
      join(dir, 'reports', 'stryker-incremental.json'),
    );

    reporter.onMutantTested(mutant('index.js', '1'));
    fire();

    assert.equal(warnings.length, 1);
    assert.match(warnings[0] ?? '', /Could not write the checkpoint/);
  });
});
