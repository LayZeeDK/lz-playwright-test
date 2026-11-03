// Spike A: one long-lived server, mutants switched between "runs" through a control file, coverage per test from a
// request header while requests of two tests interleave. Prints [OK] or [ERROR] per check; exit 1 on any error.
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const here = import.meta.dirname;
const control = join(here, 'out', 'control.json');
const port = 4810;
const mutants = JSON.parse(readFileSync(join(here, 'out', 'mutants.json'), 'utf8'));
const tests = { big: { mugs: 3, posters: 1 }, small: { mugs: 1, posters: 1 } };
let failures = 0;

function check(ok, message) {
  console.log(`${ok ? '[OK]' : '[ERROR]'} ${message}`);
  failures += ok ? 0 : 1;
}

function setActive(activeMutant) {
  writeFileSync(control, JSON.stringify(activeMutant === undefined ? {} : { activeMutant }));
}

async function ask(testId) {
  const { mugs, posters } = tests[testId];
  const response = await fetch(`http://localhost:${port}/total?mugs=${mugs}&posters=${posters}`, {
    headers: { 'x-lz-stryker-test': testId },
  });

  return (await response.json()).total;
}

async function interleaved(rounds) {
  const answers = await Promise.all(
    Array.from({ length: rounds }, (_, i) => (i % 2 === 0 ? 'big' : 'small')).map(async (id) => [id, await ask(id)]),
  );

  return answers;
}

async function takeCoverage() {
  return (await fetch(`http://localhost:${port}/__lz_stryker__/coverage`)).json();
}

setActive(undefined);
const server = spawn(process.execPath, [join(here, 'server.mjs')], {
  env: {
    ...process.env,
    NODE_OPTIONS: `--import ${pathToFileURL(join(here, 'server-hook.mjs')).href}`,
    LZ_SPIKE_CONTROL: control,
    PORT: String(port),
  },
  stdio: ['ignore', 'pipe', 'inherit'],
});
await new Promise((resolve) => server.stdout.once('data', resolve));

try {
  // Dry run: no active mutant, 40 interleaved requests.
  const baseline = Object.fromEntries((await interleaved(40)).map(([id, value]) => [id, value]));
  check(baseline.big === 56 && baseline.small === 36.95, `baseline totals ${JSON.stringify(baseline)}`);
  const coverage = await takeCoverage();
  const covered = Object.fromEntries(
    Object.entries(coverage.perTest).map(([id, hits]) => [id, new Set(Object.keys(hits))]),
  );
  check(Object.keys(covered).sort().join() === 'big,small', `per-test keys ${Object.keys(covered).join(', ')}`);
  check(Object.keys(coverage.static).length === 0, `no static hits (${Object.keys(coverage.static).length})`);
  check((await takeCoverage()).perTest.big === undefined, 'taking coverage empties it');

  // Mutant runs: switch the mutant without a restart; a test kills when its answer differs from the baseline.
  for (const { id, mutatorName, replacement } of mutants) {
    setActive(id);
    const answers = await interleaved(6);
    const killers = [...new Set(answers.filter(([test, value]) => value !== baseline[test]).map(([test]) => test))];
    const uncovered = killers.filter((test) => !covered[test]?.has(id));
    const coveredBy = Object.keys(covered).filter((test) => covered[test].has(id));
    check(uncovered.length === 0, `mutant ${id} ${mutatorName} ${replacement}: killed by [${killers}], covered by [${coveredBy}]`);
  }

  setActive(undefined);
  const after = Object.fromEntries((await interleaved(4)).map(([id, value]) => [id, value]));
  check(after.big === baseline.big && after.small === baseline.small, 'switching back to no mutant restores the baseline');
} finally {
  server.kill();
}

process.exitCode = failures === 0 ? 0 : 1;
