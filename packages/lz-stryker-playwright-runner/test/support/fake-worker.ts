// The worker hook's install against a fake Playwright in this process.
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { TestContext } from 'node:test';

import { INSTRUMENTER_CONSTANTS } from '@stryker-mutator/api/core';

import {
  type HookedBrowser,
  type HookedContext,
  type HookedFrame,
  type HookedPage,
  type Instrumentation,
  isRecord,
  type SlotType,
} from '../../src/playwright-internals.ts';
import type { RunSettings } from '../../src/protocol.ts';
import type {
  install,
  PageSettings,
  StrykerNamespace,
} from '../../src/worker-hook.ts';

const ACTIVE_MUTANT = INSTRUMENTER_CONSTANTS.ACTIVE_MUTANT_ENV_VARIABLE;

type Listener = Parameters<Instrumentation['addListener']>[0];

/** The shape of Playwright's TestInfo._timeoutManager._running.runnable. */
export interface Runnable {
  type: SlotType;
  fixture?: { title: string };
}

interface FakeFrame {
  /** The global name the frame's namespace has; undefined reads the name the hook asks for. */
  name?: string;
  evaluate?: (fn: (name: string) => unknown, name: string) => Promise<unknown>;
  detached?: boolean;
}

/**
 * Installs the hook with a fake Playwright and a namespace no other code in this process uses. The
 * namespace stands in for the worker's and for every fake page's, since the fake frames read it here.
 */
export function fakeInstall(
  installHook: typeof install,
  t: TestContext,
  settings: Omit<RunSettings, 'outDir'>,
  {
    activeMutant,
    prepare,
    info,
  }: {
    activeMutant?: string;
    /** Runs before install, as the worker's earlier code would. */
    prepare?: (outDir: string, ns: string) => void;
    /** Replaces test.info(), as a Playwright whose TestInfo changed would. */
    info?: () => unknown;
  } = {},
) {
  const ns = `__hookTest${Math.random().toString(36).slice(2)}__`;
  const outDir = mkdtempSync(path.join(tmpdir(), 'worker-hook-install-'));
  const scope: Record<string, unknown> = globalThis;
  prepare?.(outDir, ns);
  const exitListeners = process.listeners('exit');
  const previousMutant = process.env[ACTIVE_MUTANT];
  let running: string | undefined;
  let runnable: Runnable = { type: 'test' };
  let listener: Listener | undefined;
  const test = {
    info:
      info ??
      (() => {
        if (running === undefined) {
          throw new Error(
            'test.info() can only be called while a test is running',
          );
        }

        return {
          testId: running,
          config: { version: '1.64.1' },
          _timeoutManager: { _running: { runnable } },
        };
      }),
  };
  const modules: Record<string, unknown> = {
    'playwright/test': { test },
    'playwright-core': {
      _instrumentation: {
        addListener: (added: Listener) => {
          listener = added;
        },
      },
    },
  };

  if (activeMutant === undefined) {
    delete process.env[ACTIVE_MUTANT];
  } else {
    process.env[ACTIVE_MUTANT] = activeMutant;
  }

  try {
    installHook((id) => modules[id], { outDir, ...settings }, ns);
  } finally {
    if (previousMutant === undefined) {
      delete process.env[ACTIVE_MUTANT];
    } else {
      process.env[ACTIVE_MUTANT] = previousMutant;
    }
  }

  const added = process
    .listeners('exit')
    .filter((exit) => !exitListeners.includes(exit));
  t.after(() => {
    added.forEach((exit) => process.off('exit', exit));
    delete scope[ns];
    rmSync(outDir, { recursive: true, force: true });
  });

  assert.ok(listener);
  const hooks = listener;

  function frame({
    name,
    evaluate,
    detached = false,
  }: FakeFrame = {}): HookedFrame {
    return {
      evaluate: (fn, asked) =>
        evaluate ? evaluate(fn, asked) : Promise.resolve(fn(name ?? asked)),
      isDetached: () => detached,
    };
  }

  function page(frames: HookedFrame[] = [frame()]) {
    const closed: unknown[] = [];
    const created: HookedPage = {
      frames: () => frames,
      close: async (options) => {
        closed.push(options);
      },
    };

    return { page: created, closed };
  }

  function browser() {
    const contexts: HookedContext[] = [];
    const closed: unknown[] = [];
    const created: HookedBrowser = {
      contexts: () => contexts,
      close: async (options) => {
        closed.push(options);
      },
    };

    return { browser: created, contexts, closed };
  }

  /** A context as Playwright creates it, which the hook sees through the instrumentation. */
  async function context(owner: ReturnType<typeof browser> | null = null) {
    const pages: HookedPage[] = [];
    const onPage: ((page: HookedPage) => void)[] = [];
    const scripts: [unknown, PageSettings][] = [];
    const events: string[] = [];
    const created: HookedContext = {
      pages: () => pages,
      browser: () => owner?.browser ?? null,
      on: (event, handler) => {
        events.push(event);
        onPage.push(handler);
      },
      addInitScript: async (script, settings) => {
        scripts.push([script, settings]);
      },
    };
    owner?.contexts.push(created);
    await hooks.runAfterCreateBrowserContext?.(created);

    return {
      context: created,
      scripts,
      events,
      open: (opened: HookedPage) => {
        pages.push(opened);
        onPage.forEach((handler) => handler(opened));
      },
      close: () => hooks.runBeforeCloseBrowserContext?.(created),
    };
  }

  return {
    ns,
    namespace: (): StrykerNamespace => {
      const found = scope[ns];
      assert.ok(typeof found === 'object' && found !== null, 'a namespace');

      return found;
    },
    hooks,
    files: () => readdirSync(outDir),
    read: () => {
      const [file, ...more] = readdirSync(outDir);
      assert.ok(file !== undefined && more.length === 0, 'one snapshot file');

      return readFileSync(path.join(outDir, file), 'utf8');
    },
    /** `runs` is what Playwright's timeout manager runs for that test: its body by default. */
    setTest: (id: string | undefined, runs: Runnable = { type: 'test' }) => {
      running = id;
      runnable = runs;
    },
    exitListeners: added,
    frame,
    page,
    browser,
    context,
  };
}

export function parsedLines(content: string) {
  return content
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const parsed: unknown = JSON.parse(line);
      assert.ok(isRecord(parsed));

      return parsed;
    });
}
