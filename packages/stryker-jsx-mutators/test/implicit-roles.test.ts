import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isDeepStrictEqual } from 'node:util';

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
// aria-query roles by tag alone that the table leaves out.
const leftOut = ['td gridcell'];

describe('implicitRoles', () => {
  it("holds every entry of Playwright's table that needs no context", () => {
    const missing = [...playwrightRoles()].filter(
      ([tag, entry]) => !isDeepStrictEqual(implicitRoles.get(tag), entry),
    );

    assert.deepEqual(missing, []);
  });

  it("parses every entry of Playwright's table but the contextual ones", () => {
    const parsed = new Set(playwrightRoles().keys());

    assert.deepEqual(
      playwrightEntryTags()
        .filter((tag) => !parsed.has(tag))
        .sort(),
      playwrightContextual,
    );
  });

  it('holds every role aria-query gives by tag alone, but generic and the left-out ones', () => {
    assert.deepEqual(
      ariaQueryTagRoles(ariaQueryConcepts())
        .filter(
          ([tag, role]) =>
            role !== 'generic' &&
            !isDeepStrictEqual(implicitRoles.get(tag), { role }),
        )
        .map(([tag, role]) => `${tag} ${role}`)
        .sort(),
      leftOut,
    );
  });

  it('holds only roles that aria-query or Playwright gives', () => {
    const concepts = ariaQueryConcepts();
    const playwright = playwrightRoles();

    assert.deepEqual(
      [...implicitRoles].filter(
        ([tag, entry]) =>
          !ariaQueryGives(concepts, tag, entry) &&
          !isDeepStrictEqual(playwright.get(tag), entry),
      ),
      [],
    );
  });
});
