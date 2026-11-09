import assert from 'node:assert/strict';
import { it } from 'node:test';

import { install } from '../src/install.ts';
import { mutatorSets } from '../src/mutators.ts';
import { fakeInstrumenter } from './support/fake-instrumenter.ts';

async function startLineWith(options: unknown): Promise<string> {
  const { instrumenter } = fakeInstrumenter();
  const lines: string[] = [];

  await install(
    mutatorSets,
    options,
    async () => instrumenter,
    () => undefined,
    (message) => lines.push(message),
  );

  return lines.join('\n');
}

it('leaves every opt-in mutator off with no options', async () => {
  const line = await startLineWith(undefined);

  assert.doesNotMatch(line, /Opt-in/);
});

it('turns every opt-in mutator on with extended', async () => {
  const line = await startLineWith({ extended: true });

  assert.match(
    line,
    / Opt-in or experimental: LzPlaywrightSleepWait, LzPlaywrightStateWait, LzPlaywrightNetworkWait, LzPlaywrightClock, LzPlaywrightMountStory\.$/,
  );
});

it('turns one opt-in mutator on by its name', async () => {
  const line = await startLineWith({ LzPlaywrightSleepWait: true });

  assert.match(line, / Opt-in or experimental: LzPlaywrightSleepWait\.$/);
});

it('turns every experimental mutator on with experimental', async () => {
  const line = await startLineWith({ experimental: true });

  assert.match(
    line,
    / Opt-in or experimental: LzPlaywrightRequestData, LzPlaywrightRequestUrl\.$/,
  );
});

for (const name of ['LzPlaywrightRequestData', 'LzPlaywrightRequestUrl']) {
  it(`turns ${name} on alone by its name inside experimental`, async () => {
    const line = await startLineWith({ experimental: { [name]: true } });

    assert.match(line, new RegExp(` Opt-in or experimental: ${name}\\.$`));
  });
}

it('names lzPlaywrightMutators when options reach a roster with no opt-in or experimental mutators', async () => {
  const { instrumenter } = fakeInstrumenter();

  await assert.rejects(
    install(
      { defaults: mutatorSets.defaults, optIn: [], experimental: [] },
      { extended: true },
      async () => instrumenter,
      () => undefined,
      () => undefined,
    ),
    { message: /, so lzPlaywrightMutators\(\) takes no options\./ },
  );
});

it('leaves every experimental mutator off with extended', async () => {
  const line = await startLineWith({ extended: true });

  assert.doesNotMatch(line, /LzPlaywrightRequest/);
});
