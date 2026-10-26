import type { PartialStrykerOptions } from '@stryker-mutator/api/core';

export default {
  concurrency: 1,
  reporters: ['clear-text', 'progress', 'json'],
  // /.nx: a copied .nx/workspace-data sends the sandbox's Nx to this workspace's daemon, which refuses it.
  // /.claude: Claude Code worktrees are whole checkouts. /.stryker-tmp*: Stryker ignores only its own
  // tempDirName, so this keeps the other demo configs' temp dirs out of the sandbox.
  ignorePatterns: ['/.nx', '/.claude', '/.stryker-tmp*'],
} satisfies PartialStrykerOptions;
