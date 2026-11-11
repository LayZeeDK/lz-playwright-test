import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, type TestContext } from 'node:test';

import { appendRecord, recordVariable } from '../src/stryker-record.ts';

function setup(t: TestContext) {
  const folder = mkdtempSync(join(tmpdir(), 'lz-record-'));
  const recordFile = join(folder, 'records.jsonl');
  const previousRecord = process.env[recordVariable];
  writeFileSync(recordFile, '');
  process.env[recordVariable] = recordFile;
  t.after(() => {
    if (previousRecord === undefined) {
      delete process.env[recordVariable];
    } else {
      process.env[recordVariable] = previousRecord;
    }

    rmSync(folder, { recursive: true });
  });

  return { recordFile };
}

describe('appendRecord', () => {
  it('appends one line with the project-relative file and the rewrite count', (t) => {
    const { recordFile } = setup(t);

    appendRecord(join(process.cwd(), 'src', 'Button.stories.tsx'), 2);

    assert.equal(
      readFileSync(recordFile, 'utf8'),
      '{"file":"src/Button.stories.tsx","rewritten":2}\n',
    );
  });
});
