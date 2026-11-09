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

it('gives the size of each tier in the opening counts and in the default install line', () => {
  const { defaults, optIn, experimental } = mutatorSets;
  const total = defaults.length + optIn.length + experimental.length;
  const readme = readmeLines.join(' ');

  assert.ok(
    readme.includes(
      `adds ${total} of its own: ${defaults.length} run by default, ${optIn.length} are opt-in and ${experimental.length} are`,
    ),
    'the opening counts',
  );
  assert.ok(
    readme.includes(`${defaults.length} LzPlaywright mutators on`),
    'the default install line',
  );
});

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
