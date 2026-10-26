// IMPLICIT_ROLE is copied from Playwright's role table, so a Playwright upgrade that changes the table fails here
// instead of leaving ElementRole with a role-removal mutant no locator can kill.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';

import { IMPLICIT_ROLE } from '../src/operators.ts';

const require = createRequire(import.meta.url);
const BUNDLE = join(
  dirname(require.resolve('playwright-core/package.json')),
  'lib',
  'coreBundle.js',
);

// The injected script sits in the bundle as one string literal, so its newlines and quotes are escaped.
function playwrightTable(): Map<string, string | undefined> {
  const bundle = readFileSync(BUNDLE, 'utf8');
  const start = bundle.indexOf('kImplicitRoleByTagName = {');
  const end = bundle.indexOf('\\n};', start);
  assert.ok(
    start >= 0 && end > start,
    `kImplicitRoleByTagName not found in ${BUNDLE}`,
  );
  const body = bundle
    .slice(start, end)
    .replaceAll('\\n', '\n')
    .replaceAll('\\"', '"');
  const table = new Map<string, string | undefined>();

  for (const [, tag, parameter, result] of body.matchAll(
    /^\s+"([A-Z0-9]+)": \((\w*)\) => (.*)$/gm,
  )) {
    const constant =
      parameter === '' ? /^"([a-z]+)",?$/.exec(result.trim()) : null;
    table.set(tag.toLowerCase(), constant?.[1]);
  }

  return table;
}

describe('IMPLICIT_ROLE', () => {
  it("reads all of Playwright's table (62 tags in 1.64.1)", () => {
    assert.ok(
      playwrightTable().size >= 60,
      `only ${playwrightTable().size} tags read from ${BUNDLE}`,
    );
  });

  it("holds exactly the tags whose role Playwright's getByRole gives in any context", () => {
    const constant = [...playwrightTable()].filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    );

    assert.deepEqual(
      new Map([...IMPLICIT_ROLE].sort()),
      new Map(constant.sort()),
    );
  });
});
