import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { implicitRoles } from '../src/implicit-roles.ts';
import {
  ariaQueryConcepts,
  ariaQueryGives,
  ariaQueryTagRoles,
  playwrightEntryTags,
  playwrightRoles,
} from './support/engine-roles.ts';

// Playwright gives these a role only in some contexts, or only with an accessible name or certain attributes.
const playwrightContextual = [
  'footer',
  'form',
  'header',
  'img',
  'input',
  'section',
  'select',
  'td',
  'th',
];

describe('implicitRoles', () => {
  it("holds every entry of Playwright's table that needs no context", () => {
    const missing = [...playwrightRoles()].filter(
      ([tag, entry]) =>
        JSON.stringify(implicitRoles.get(tag)) !== JSON.stringify(entry),
    );

    assert.deepEqual(missing, []);
  });

  it("parses every entry of Playwright's table but the contextual ones", () => {
    const parsed = new Set(playwrightRoles().keys());

    assert.deepEqual(
      playwrightEntryTags().filter((tag) => !parsed.has(tag)),
      playwrightContextual,
    );
  });

  it('holds every role aria-query gives by tag alone, but generic and the cell of a grid', () => {
    assert.deepEqual(
      ariaQueryTagRoles(ariaQueryConcepts())
        .filter(
          ([tag, role]) =>
            role !== 'generic' &&
            !(
              implicitRoles.get(tag)?.role === role &&
              implicitRoles.get(tag)?.requiredAttribute === undefined
            ),
        )
        .map(([tag, role]) => `${tag} ${role}`),
      ['td gridcell'],
    );
  });

  it('holds only roles some engine gives: aria-query, or Playwright for search and svg', () => {
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
