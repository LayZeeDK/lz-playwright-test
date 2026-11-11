import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { type TestContext, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  lzStorybookMockResetPlugin,
  mockResetConfig,
} from '../src/mock-reset.ts';
import { resetModuleMockSpies } from '../src/module-mock-spies.ts';

const registryKey = '__STORYBOOK_MODULE_MOCK_SPIES__';

function setRegistry(t: TestContext, registry: unknown): void {
  const previous: unknown = Reflect.get(globalThis, registryKey);
  const had = registryKey in globalThis;

  if (registry === undefined) {
    Reflect.deleteProperty(globalThis, registryKey);
  } else {
    Reflect.set(globalThis, registryKey, registry);
  }

  t.after(() => {
    if (had) {
      Reflect.set(globalThis, registryKey, previous);
    } else {
      Reflect.deleteProperty(globalThis, registryKey);
    }
  });
}

describe('lzStorybookMockResetPlugin', () => {
  it('is named lz-storybook-mock-reset', () => {
    assert.equal(lzStorybookMockResetPlugin().name, 'lz-storybook-mock-reset');
  });

  it('adds the setup module as Vite resolves its config', () => {
    assert.equal(lzStorybookMockResetPlugin().config, mockResetConfig);
  });
});

describe('mockResetConfig', () => {
  it('adds the setup module that resets the spies before each test', () => {
    const setupFile = fileURLToPath(
      new URL('../src/mock-reset.setup.ts', import.meta.url),
    );

    assert.deepEqual(mockResetConfig(), { test: { setupFiles: [setupFile] } });
    assert.ok(existsSync(setupFile), `${setupFile} exists`);
  });
});

describe('resetModuleMockSpies', () => {
  it('does nothing when no story module has loaded storybook/test', (t) => {
    setRegistry(t, undefined);

    assert.doesNotThrow(() => resetModuleMockSpies());
  });

  it("resets every spy that sb.mock put in Storybook's registry", (t) => {
    const resets: string[] = [];
    const spy = (name: string) => ({ mockReset: () => resets.push(name) });
    setRegistry(t, new Set([spy('getName'), spy('getUser')]));

    resetModuleMockSpies();

    assert.deepEqual(resets, ['getName', 'getUser']);
  });

  it('names the registry when it holds something other than a spy', (t) => {
    setRegistry(t, new Set([{}]));

    assert.throws(() => resetModuleMockSpies(), {
      name: 'TypeError',
      message: /__STORYBOOK_MODULE_MOCK_SPIES__/,
    });
  });

  it('names the registry when it holds a value that is not an object', (t) => {
    setRegistry(t, new Set(['getName']));

    assert.throws(() => resetModuleMockSpies(), {
      name: 'TypeError',
      message: /__STORYBOOK_MODULE_MOCK_SPIES__/,
    });
  });

  it('resets a spy that is a function, as Vitest spies are', (t) => {
    let resets = 0;
    const spy = Object.assign(() => undefined, { mockReset: () => resets++ });
    setRegistry(t, new Set([spy]));

    resetModuleMockSpies();

    assert.equal(resets, 1);
  });
});
