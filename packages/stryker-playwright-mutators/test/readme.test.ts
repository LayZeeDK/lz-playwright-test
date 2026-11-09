import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { it } from 'node:test';

import { mutatorSets } from '../src/mutators.ts';

const readmeLines = readFileSync(
  join(import.meta.dirname, '..', 'README.md'),
  'utf8',
).split(/\r?\n/);

function tableNames(heading: string): readonly string[] {
  const start = readmeLines.indexOf(heading);

  if (start === -1) {
    return [];
  }

  const section = readmeLines.slice(start + 1);
  const end = section.findIndex((line) => line.startsWith('#'));

  return section
    .slice(0, end === -1 ? section.length : end)
    .flatMap((line) => /^\| `(\w+)` +\|/.exec(line)?.slice(1) ?? []);
}

function namesOf(
  tier: readonly { readonly name: string }[],
): readonly string[] {
  return tier.map(({ name }) => name);
}

it('lists the mutators of each tier in the README table of that tier, in roster order', () => {
  assert.deepEqual(
    {
      defaults: tableNames('### Default mutators'),
      optIn: tableNames('### Opt-in mutators'),
      experimental: tableNames('### Experimental mutators'),
    },
    {
      defaults: namesOf(mutatorSets.defaults),
      optIn: namesOf(mutatorSets.optIn),
      experimental: namesOf(mutatorSets.experimental),
    },
  );
});
