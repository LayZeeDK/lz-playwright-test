// The worker hook's init script, which every page runs before its own scripts, in a fake page.
import assert from 'node:assert/strict';
import { before, type TestContext, test } from 'node:test';

import type { PageSettings } from '../src/protocol.ts';
import type * as Hook from '../src/worker-hook.ts';
import type { StrykerNamespace } from '../src/worker-hook.ts';

let hook: typeof Hook;

// The hook installs at import when its gate opens, so a mutant that breaks the gate fails in a test.
before(async () => {
  hook = await import('../src/worker-hook.ts');
});

interface FakePage {
  readonly top?: boolean;
  readonly carried?: string | null;
  readonly storageThrows?: boolean;
  readonly prepare?: (ns: string) => void;
}

/** Runs the init script with the page globals it uses, and returns the namespace and storage it left. */
function pageRun(
  t: TestContext,
  settings: Omit<PageSettings, 'ns'>,
  { top = true, carried = null, storageThrows = false, prepare }: FakePage = {},
) {
  const ns = `__pageTest${Math.random().toString(36).slice(2)}__`;
  const stored = new Map<string, string>();
  const listeners: [string, () => void][] = [];

  if (carried !== null) {
    stored.set(`${ns}:carry`, carried);
  }

  const win: { top?: unknown } = {};
  win.top = top ? win : {};
  const globals: Record<string, unknown> = {
    window: win,
    sessionStorage: {
      getItem: (key: string) => {
        if (storageThrows) {
          throw new Error('SecurityError');
        }

        return stored.get(key) ?? null;
      },
      setItem: (key: string, value: string) => stored.set(key, value),
    },
    addEventListener: (event: string, listener: () => void) =>
      listeners.push([event, listener]),
  };
  const saved = Object.keys(globals).map(
    (name) =>
      [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const,
  );
  const scope: Record<string, unknown> = globalThis;
  t.after(() => {
    delete scope[ns];
  });
  prepare?.(ns);

  // The page globals exist only while page code runs, so nothing else in this process sees them.
  function inPage(run: () => void) {
    Object.entries(globals).forEach(([name, value]) => {
      Object.defineProperty(globalThis, name, {
        value,
        configurable: true,
        writable: true,
      });
    });

    try {
      run();
    } finally {
      saved.forEach(([name, descriptor]) => {
        if (descriptor) {
          Object.defineProperty(globalThis, name, descriptor);
        } else {
          delete scope[name];
        }
      });
    }
  }

  inPage(() => hook.initPage({ ns, ...settings }));
  const found = scope[ns];
  assert.ok(typeof found === 'object' && found !== null, 'a page namespace');
  const s: StrykerNamespace = found;

  return {
    ns,
    s,
    stored,
    listeners,
    fire: (event: string) =>
      inPage(() =>
        listeners
          .filter(([name]) => name === event)
          .forEach(([, listener]) => listener()),
      ),
  };
}

test('the init script sets the mutant, the test and a zeroed hit count in the page namespace', (t) => {
  const { s } = pageRun(t, { activeMutant: '3', testId: 't1', hitLimit: 7 });

  assert.deepEqual(
    { ...s },
    {
      activeMutant: '3',
      hitLimit: 7,
      hitCount: 0,
      currentTestId: 't1',
    },
  );
});

test('the init script sets nothing it was not given', (t) => {
  const { s } = pageRun(t, {});

  assert.deepEqual({ ...s }, {});
});

test('the init script keeps a namespace the page already has', (t) => {
  const existing = { kept: true };
  const { s } = pageRun(
    t,
    { testId: 't1' },
    {
      top: false,
      prepare: (ns) => {
        const scope: Record<string, unknown> = globalThis;
        scope[ns] = existing;
      },
    },
  );

  assert.equal(s, existing);
  assert.deepEqual(existing, { kept: true, currentTestId: 't1' });
});

test('the init script replaces a namespace that is null with its own', (t) => {
  const { s } = pageRun(
    t,
    { testId: 't1' },
    {
      top: false,
      prepare: (ns) => {
        const scope: Record<string, unknown> = globalThis;
        scope[ns] = null;
      },
    },
  );

  assert.deepEqual(s, { currentTestId: 't1' });
});

test('a carried value that is not an object carries nothing in, and the page still stores its own', (t) => {
  ['5', '"text"', 'null'].forEach((carried) => {
    const { s, listeners } = pageRun(t, { hitLimit: 7 }, { carried });

    assert.deepEqual({ ...s }, { hitLimit: 7, hitCount: 0 }, carried);
    assert.deepEqual(
      listeners.map(([event]) => event),
      ['pagehide'],
    );
  });
});

test('a child frame carries nothing across navigations', (t) => {
  const { s, listeners } = pageRun(
    t,
    { hitLimit: 7 },
    {
      top: false,
      carried: '{"mutantCoverage":{"static":{"1":1}},"hitCount":4}',
    },
  );

  assert.deepEqual({ ...s }, { hitLimit: 7, hitCount: 0 });
  assert.deepEqual(listeners, []);
});

test('the top frame takes over the coverage and hit count the last page left', (t) => {
  const { s } = pageRun(
    t,
    { hitLimit: 7 },
    { carried: '{"mutantCoverage":{"static":{"1":1}},"hitCount":4}' },
  );

  assert.deepEqual(
    { ...s },
    {
      hitLimit: 7,
      hitCount: 4,
      mutantCoverage: { static: { '1': 1 } },
    },
  );
});

test('a carried page without a hit count starts from zero, and without a hit limit counts nothing', (t) => {
  const limited = pageRun(
    t,
    { hitLimit: 7 },
    { carried: '{"mutantCoverage":{}}' },
  );
  const unlimited = pageRun(
    t,
    {},
    { carried: '{"mutantCoverage":{},"hitCount":4}' },
  );

  assert.equal(limited.s.hitCount, 0);
  assert.equal(unlimited.s.hitCount, undefined);
  assert.equal(Object.hasOwn(unlimited.s, 'hitCount'), false);
});

test('a first page carries nothing in', (t) => {
  const { s } = pageRun(t, {});

  assert.equal(Object.hasOwn(s, 'mutantCoverage'), false);
});

test('the top frame stores its coverage and hit count when the page goes away', (t) => {
  const { ns, s, stored, listeners, fire } = pageRun(t, { hitLimit: 7 });
  s.mutantCoverage = { static: { '2': 1 } };
  s.hitCount = 3;

  assert.deepEqual(
    listeners.map(([event]) => event),
    ['pagehide'],
  );

  fire('pagehide');

  assert.equal(
    stored.get(`${ns}:carry`),
    '{"mutantCoverage":{"static":{"2":1}},"hitCount":3}',
  );
});

test('a page without session storage still gets its namespace', (t) => {
  const { s } = pageRun(t, { testId: 't1' }, { storageThrows: true });

  assert.deepEqual({ ...s }, { currentTestId: 't1' });
});
