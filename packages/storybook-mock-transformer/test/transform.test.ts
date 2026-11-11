import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { transform } from '../src/transform.ts';

const storyFile = 'D:/project/src/Button.stories.tsx';
const stubbedStory = [
  "import { fn } from 'storybook/test';",
  "export const Checked = { args: { load: fn().mockReturnValue('stubbed') } };",
  '',
].join('\n');

function recordWhile(run: () => void): string {
  const folder = mkdtempSync(join(tmpdir(), 'lz-record-'));
  const recordFile = join(folder, 'records.jsonl');
  writeFileSync(recordFile, '');
  process.env['LZ_STRYKER_STORYBOOK_RECORD'] = recordFile;

  try {
    run();

    return readFileSync(recordFile, 'utf8');
  } finally {
    delete process.env['LZ_STRYKER_STORYBOOK_RECORD'];
    rmSync(folder, { recursive: true });
  }
}

describe('transform records', () => {
  it('appends one line with the project-relative file and the rewrite count when the record variable is set', () => {
    const file = join(process.cwd(), 'src', 'Button.stories.tsx');

    assert.equal(
      recordWhile(() => transform(stubbedStory, `${file}?v=1`)),
      '{"file":"src/Button.stories.tsx","rewritten":1}\n',
    );
  });

  it('appends nothing for a module it leaves alone', () => {
    const file = join(process.cwd(), 'src', 'Button.stories.tsx');

    assert.equal(
      recordWhile(() =>
        transform(
          stubbedStory.replace('mockReturnValue', 'mockReturnValueOnce'),
          file,
        ),
      ),
      '',
    );
  });
});

describe('transform', () => {
  it('leaves a module without a storybook/test import alone', () => {
    assert.equal(
      transform("export const label = 'none';\n", storyFile),
      undefined,
    );
  });

  it('turns a definition-time mockReturnValue into fn with an implementation that returns the value', () => {
    const code = [
      "import { fn } from 'storybook/test';",
      "export const Checked = { args: { load: fn().mockReturnValue('stubbed') } };",
      '',
    ].join('\n');

    assert.equal(
      transform(code, storyFile)?.code,
      [
        "import { fn } from 'storybook/test';",
        "export const Checked = { args: { load: ((value) => fn(() => value))('stubbed') } };",
        '',
      ].join('\n'),
    );
  });

  it('turns a definition-time mockResolvedValue into fn with an async implementation that returns the value', () => {
    const code = [
      "import { fn } from 'storybook/test';",
      'export const meta = { args: { save: fn().mockResolvedValue(42) } };',
      '',
    ].join('\n');

    assert.equal(
      transform(code, storyFile)?.code,
      [
        "import { fn } from 'storybook/test';",
        'export const meta = { args: { save: ((value) => fn(async () => value))(42) } };',
        '',
      ].join('\n'),
    );
  });

  it('turns a definition-time mockRejectedValue into fn with an async implementation that throws the value', () => {
    const code = [
      "import { fn } from 'storybook/test';",
      "const failing = fn().mockRejectedValue(new Error('offline'));",
      '',
    ].join('\n');

    assert.equal(
      transform(code, storyFile)?.code,
      [
        "import { fn } from 'storybook/test';",
        "const failing = ((value) => fn(async () => { throw value; }))(new Error('offline'));",
        '',
      ].join('\n'),
    );
  });

  it('turns a definition-time mockImplementation into fn with that implementation', () => {
    const code = [
      "import { fn } from 'storybook/test';",
      "export const Story = { args: { onLoad: fn().mockImplementation(() => 'stubbed') } };",
      '',
    ].join('\n');

    assert.equal(
      transform(code, storyFile)?.code,
      [
        "import { fn } from 'storybook/test';",
        "export const Story = { args: { onLoad: fn(() => 'stubbed') } };",
        '',
      ].join('\n'),
    );
  });

  it('turns a mockReturnValue on an optional call of fn into fn with an implementation that returns the value', () => {
    const code = [
      "import { fn } from 'storybook/test';",
      "export const Checked = { args: { load: fn?.().mockReturnValue('stubbed') } };",
      '',
    ].join('\n');

    assert.equal(
      transform(code, storyFile)?.code,
      [
        "import { fn } from 'storybook/test';",
        "export const Checked = { args: { load: ((value) => fn(() => value))('stubbed') } };",
        '',
      ].join('\n'),
    );
  });

  it('leaves a definition-time mockReturnValueOnce alone', () => {
    const code = [
      "import { fn } from 'storybook/test';",
      "export const Once = { args: { load: fn().mockReturnValueOnce('stubbed') } };",
      '',
    ].join('\n');

    assert.equal(transform(code, storyFile), undefined);
  });

  it('leaves a definition-time mockResolvedValueOnce alone', () => {
    const code = [
      "import { fn } from 'storybook/test';",
      'export const Once = { args: { save: fn().mockResolvedValueOnce(42) } };',
      '',
    ].join('\n');

    assert.equal(transform(code, storyFile), undefined);
  });

  it('leaves a definition-time mockRejectedValueOnce alone', () => {
    const code = [
      "import { fn } from 'storybook/test';",
      "export const Once = { args: { save: fn().mockRejectedValueOnce(new Error('offline')) } };",
      '',
    ].join('\n');

    assert.equal(transform(code, storyFile), undefined);
  });

  it('leaves a definition-time mockImplementationOnce alone', () => {
    const code = [
      "import { fn } from 'storybook/test';",
      "export const Once = { args: { onLoad: fn().mockImplementationOnce(() => 'stubbed') } };",
      '',
    ].join('\n');

    assert.equal(transform(code, storyFile), undefined);
  });

  it('leaves a stub inside a function alone', () => {
    const code = [
      "import { fn } from 'storybook/test';",
      'export const Story = {',
      "  play: () => { fn().mockReturnValue('later'); },",
      '};',
      '',
    ].join('\n');

    assert.equal(transform(code, storyFile), undefined);
  });

  it('rewrites fn imported under another name with that name', () => {
    const code = [
      "import { fn as spy } from 'storybook/test';",
      "export const Checked = { args: { load: spy().mockReturnValue('stubbed') } };",
      '',
    ].join('\n');

    assert.equal(
      transform(code, storyFile)?.code,
      [
        "import { fn as spy } from 'storybook/test';",
        "export const Checked = { args: { load: ((value) => spy(() => value))('stubbed') } };",
        '',
      ].join('\n'),
    );
  });

  it('rewrites fn imported by a string name with its local name', () => {
    const code = [
      "import { 'fn' as spy } from 'storybook/test';",
      "export const Checked = { args: { load: spy().mockReturnValue('stubbed') } };",
      '',
    ].join('\n');

    assert.equal(
      transform(code, storyFile)?.code,
      [
        "import { 'fn' as spy } from 'storybook/test';",
        "export const Checked = { args: { load: ((value) => spy(() => value))('stubbed') } };",
        '',
      ].join('\n'),
    );
  });

  it('leaves a stub on an fn imported from another module alone', () => {
    const code = [
      "import { expect } from 'storybook/test';",
      "import { fn } from './spies';",
      "export const Checked = { args: { load: fn().mockReturnValue('stubbed') } };",
      '',
    ].join('\n');

    assert.equal(transform(code, storyFile), undefined);
  });

  it('leaves a stub on vi.fn alone', () => {
    const code = [
      "import { expect } from 'storybook/test';",
      "import { vi } from 'vitest';",
      "export const Checked = { args: { load: vi.fn().mockReturnValue('stubbed') } };",
      '',
    ].join('\n');

    assert.equal(transform(code, storyFile), undefined);
  });

  it('leaves a stub with no argument alone', () => {
    const code = [
      "import { fn } from 'storybook/test';",
      'export const Empty = { args: { load: fn().mockReturnValue() } };',
      '',
    ].join('\n');

    assert.equal(transform(code, storyFile), undefined);
  });

  it('rewrites every definition-time stub in a module', () => {
    const code = [
      "import { fn } from 'storybook/test';",
      'export const Both = {',
      "  args: { load: fn().mockReturnValue('a'), save: fn().mockResolvedValue('b') },",
      '};',
      '',
    ].join('\n');

    assert.equal(
      transform(code, storyFile)?.code,
      [
        "import { fn } from 'storybook/test';",
        'export const Both = {',
        "  args: { load: ((value) => fn(() => value))('a'), save: ((value) => fn(async () => value))('b') },",
        '};',
        '',
      ].join('\n'),
    );
  });

  it('throws on a module that does not parse, naming the package and the file', () => {
    const code = ["import { fn } from 'storybook/test';", 'const = ;', ''].join(
      '\n',
    );

    assert.throws(() => transform(code, storyFile), {
      message:
        /^@layzee\/storybook-mock-transformer: cannot parse D:\/project\/src\/Button\.stories\.tsx: /,
    });
  });

  it('parses a .ts module with an angle-bracket type assertion', () => {
    const code = [
      "import { fn } from 'storybook/test';",
      "const label = <string>'stubbed';",
      'export const load = fn().mockReturnValue(label);',
      '',
    ].join('\n');

    assert.equal(
      transform(code, 'D:/project/src/spies.ts')?.code,
      [
        "import { fn } from 'storybook/test';",
        "const label = <string>'stubbed';",
        'export const load = ((value) => fn(() => value))(label);',
        '',
      ].join('\n'),
    );
  });

  it('reads the file type from the id without its query', () => {
    const code = [
      "import { fn } from 'storybook/test';",
      "export const load = fn().mockReturnValue(<string>'stubbed');",
      '',
    ].join('\n');

    assert.equal(
      transform(code, 'D:/project/src/spies.ts?v=1')?.code,
      [
        "import { fn } from 'storybook/test';",
        "export const load = ((value) => fn(() => value))(<string>'stubbed');",
        '',
      ].join('\n'),
    );
  });

  it('leaves a file that is not a script alone, even when it names storybook/test', () => {
    const code = [
      "import { Meta } from '@storybook/addon-docs/blocks';",
      '',
      '# Stubs come from `storybook/test`',
      '',
    ].join('\n');

    assert.equal(transform(code, 'D:/project/src/Stubs.mdx'), undefined);
  });

  it('returns a source map of the file it rewrote', () => {
    const code = [
      "import { fn } from 'storybook/test';",
      "export const Checked = { args: { load: fn().mockReturnValue('stubbed') } };",
      '',
    ].join('\n');

    assert.deepEqual(transform(code, `${storyFile}?v=1`)?.map.sources, [
      storyFile,
    ]);
  });
});
