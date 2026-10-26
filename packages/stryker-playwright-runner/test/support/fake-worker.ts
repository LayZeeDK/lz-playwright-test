// The worker hook's install against a fake Playwright in this process.
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { TestContext } from 'node:test';

import type { Browser, BrowserContext, Frame, Page } from '@playwright/test';
import { INSTRUMENTER_CONSTANTS } from '@stryker-mutator/api/core';

import type { Instrumentation } from '../../src/playwright-internals.ts';
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
  type: string;
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
  }: {
    activeMutant?: string;
    /** Runs before install, as the worker's earlier code would. */
    prepare?: (outDir: string, ns: string) => void;
  } = {},
) {
  const ns = `__hookTest${Math.random().toString(36).slice(2)}__`;
  const outDir = mkdtempSync(path.join(tmpdir(), 'worker-hook-install-'));
  const scope = globalThis as unknown as Record<
    string,
    StrykerNamespace & Record<string, unknown>
  >;
  prepare?.(outDir, ns);
  const exitListeners = process.listeners('exit');
  const previousMutant = process.env[ACTIVE_MUTANT];
  let running: string | undefined;
  let runnable: Runnable = { type: 'test' };
  let listener: Listener | undefined;
  const test = {
    info: () => {
      if (running === undefined) {
        throw new Error(
          'test.info() can only be called while a test is running',
        );
      }

      return { testId: running, _timeoutManager: { _running: { runnable } } };
    },
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
    installHook(
      ((id: string) => modules[id]) as NodeJS.Require,
      { outDir, ...settings },
      ns,
    );
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

  function frame({ name, evaluate, detached = false }: FakeFrame = {}): Frame {
    return {
      evaluate: (fn: (name: string) => unknown, asked: string) =>
        evaluate ? evaluate(fn, asked) : Promise.resolve(fn(name ?? asked)),
      isDetached: () => detached,
    } as unknown as Frame;
  }

  function page(frames: Frame[] = [frame()]) {
    const closed: unknown[] = [];
    const fake = {
      frames: () => frames,
      close: async (options?: unknown) => {
        closed.push(options);
      },
    };

    return { page: fake as unknown as Page, closed };
  }

  function browser() {
    const contexts: BrowserContext[] = [];
    const closed: unknown[] = [];
    const fake = {
      contexts: () => contexts,
      close: async (options?: unknown) => {
        closed.push(options);
      },
    };

    return { browser: fake as unknown as Browser, contexts, closed };
  }

  /** A context as Playwright creates it, which the hook sees through the instrumentation. */
  async function context(owner: ReturnType<typeof browser> | null = null) {
    const pages: Page[] = [];
    const onPage: ((page: Page) => void)[] = [];
    const scripts: [unknown, PageSettings][] = [];
    const events: string[] = [];
    const fake = {
      pages: () => pages,
      browser: () => owner?.browser ?? null,
      on: (event: string, handler: (page: Page) => void) => {
        events.push(event);
        onPage.push(handler);
      },
      addInitScript: async (script: unknown, arg: PageSettings) => {
        scripts.push([script, arg]);
      },
    };
    const created = fake as unknown as BrowserContext;
    owner?.contexts.push(created);
    await hooks.runAfterCreateBrowserContext?.(created);

    return {
      context: created,
      scripts,
      events,
      open: (opened: Page) => {
        pages.push(opened);
        onPage.forEach((handler) => handler(opened));
      },
      close: () => hooks.runBeforeCloseBrowserContext?.(created),
    };
  }

  return {
    ns,
    scope,
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
    .map((line) => JSON.parse(line));
}
