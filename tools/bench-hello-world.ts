// Interleaved A/B on a stryker-playwright-hello-world checkout: this runner against the repo's own
// command runner, five rounds, so warmup and drift hit both sides alike.
// Run: node tools/bench-hello-world.ts <hello-world dir> [rounds]
// The checkout needs this runner installed and a stryker.playwright.config.mjs (testRunner 'playwright').
// The command side rebuilds the repo's docs/ folder, so run it in a scratch checkout.
import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const [dir, rounds = '5'] = process.argv.slice(2);

if (!dir) {
  throw new Error(
    'Usage: node tools/bench-hello-world.ts <hello-world dir> [rounds]',
  );
}

const viteConfig = path.join(dir, 'vite.config.js');
// The repo bakes the active mutant into its build with a Vite define, which would override this
// runner's value, so the runner side runs without it.
const withDefine = readFileSync(viteConfig, 'utf8');
const withoutDefine =
  'import { defineConfig } from "vite";\n\nexport default defineConfig({});\n';
const sides = [
  {
    name: 'runner',
    config: 'stryker.playwright.config.mjs',
    vite: withoutDefine,
  },
  { name: 'command', config: 'stryker.config.mjs', vite: withDefine },
];

console.log('round\tside\tseconds\tkilled\ttimeout\tsurvived\texit');

try {
  for (let round = 1; round <= Number(rounds); round++) {
    for (const side of sides) {
      writeFileSync(viteConfig, side.vite);
      rmSync(path.join(dir, '.stryker-tmp'), { recursive: true, force: true });
      rmSync(path.join(dir, '.stryker-tmp-pw'), {
        recursive: true,
        force: true,
      });
      const started = performance.now();
      const run = spawnSync(`npx stryker run ${side.config}`, {
        cwd: dir,
        shell: true,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
      });

      if (run.error) {
        throw run.error;
      }

      const seconds = Math.round((performance.now() - started) / 1000);
      const totals = run.stdout
        .split('\n')
        .find((line) => line.startsWith('All files'))
        ?.split('|')
        .map((cell) => cell.trim());

      console.log(
        [
          round,
          side.name,
          seconds,
          totals?.[3],
          totals?.[4],
          totals?.[5],
          run.status,
        ].join('\t'),
      );
    }
  }
} finally {
  writeFileSync(viteConfig, withDefine);
}
