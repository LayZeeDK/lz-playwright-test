import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { packageName } from '../src/package-name.ts';
import { parseSettings } from '../src/settings.ts';

const notObjects: readonly (readonly [string, unknown, string])[] = [
  ['a string', 'x', "'x'"],
  ['a number', 3, '3'],
  ['null', null, 'null'],
  ['an array', [], '[]'],
];

const badLists: readonly (readonly [string, unknown, string])[] = [
  ['a string', 'visit', "'visit'"],
  ['null', null, 'null'],
  ['an entry that is no string', [1], '[ 1 ]'],
  ['an entry with a dash', ['a-b'], "[ 'a-b' ]"],
  ['an entry that starts with a digit', ['1a'], "[ '1a' ]"],
  ['an empty entry', [''], "[ '' ]"],
  ['a member path', ['page.goto'], "[ 'page.goto' ]"],
];

describe('parseSettings', () => {
  it("lists 'navigate' as the navigation fixture when no settings are given", () => {
    assert.deepEqual(parseSettings(undefined), {
      navigationFixtures: ['navigate'],
    });
  });

  it('refuses a key it does not know, and names the keys it takes', () => {
    assert.throws(() => parseSettings({ navigationFixture: ['visit'] }), {
      message: `${packageName}: the settings have no key navigationFixture; the keys are navigationFixtures.`,
    });
  });

  it('keeps the given list in place of the default, empty list included', () => {
    assert.deepEqual(parseSettings({ navigationFixtures: ['visit', '$go'] }), {
      navigationFixtures: ['visit', '$go'],
    });
    assert.deepEqual(parseSettings({ navigationFixtures: [] }), {
      navigationFixtures: [],
    });
  });

  badLists.forEach(([title, value, shown]) => {
    it(`refuses ${title} as navigationFixtures`, () => {
      assert.throws(() => parseSettings({ navigationFixtures: value }), {
        message: `${packageName}: navigationFixtures takes an array of identifier names, not ${shown}.`,
      });
    });
  });

  notObjects.forEach(([title, value, shown]) => {
    it(`refuses ${title} as the settings`, () => {
      assert.throws(() => parseSettings(value), {
        message: `${packageName}: the settings must be an object, not ${shown}.`,
      });
    });
  });
});
