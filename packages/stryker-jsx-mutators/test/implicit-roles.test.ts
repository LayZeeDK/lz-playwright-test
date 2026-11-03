import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { implicitRoles } from '../src/implicit-roles.ts';
import {
  ariaQueryConcepts,
  ariaQueryGives,
  playwrightRoles,
} from './support/engine-roles.ts';

describe('implicitRoles', () => {
  it("equals Playwright's table", () => {
    assert.deepEqual(implicitRoles, playwrightRoles());
  });

  it('agrees with aria-query on every tag but search and svg', () => {
    const concepts = ariaQueryConcepts();

    assert.deepEqual(
      [...implicitRoles]
        .filter(([tag, entry]) => !ariaQueryGives(concepts, tag, entry))
        .map(([tag]) => tag)
        .sort(),
      ['search', 'svg'],
    );
  });
});
