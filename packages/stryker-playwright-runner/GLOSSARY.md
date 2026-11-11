# Playwright runner

The `lz-playwright` StrykerJS test runner: it runs Playwright e2e and component tests as Stryker tests, gives
each run's mutant to the pages, the Playwright workers and, with server support on, the `webServer`, and
collects per-test coverage from all three.

## Language

### Processes

**Test runner process**:
One process that Stryker starts to run tests; it starts its own `webServer` and Playwright workers, and
Stryker replaces it after a timeout or `maxTestRunnerReuse` runs.
_Avoid_: Stryker worker, runner instance

**Playwright worker**:
A process that Playwright starts inside a test runner process to run test files; `lzPlaywright.workers`
sets how many.
_Avoid_: worker (alone), test worker

**Temp root**:
The private folder in the OS temp directory that one test runner process owns for its Playwright output and
run files, and that a later process can remove when it was left behind.
_Avoid_: output dir, temp dir

**Playwright internals**:
The parts of Playwright that the runner calls although Playwright does not export them; a release that
changes them stops the runner with an error that names them.
_Avoid_: private API, hacks

### Runs and tests

**Selected test**:
A test in Stryker's test filter for a mutant run, that is, a test whose coverage reached the mutant.
_Avoid_: covering test, filtered test

**Added test**:
A test the runner runs in a mutant run although Stryker did not select it: another test of a selected
test's serial group, or a test of a dependency project.
_Avoid_: extra test, implied test

**Serial group**:
The tests of one `describe.serial` block, which the runner always runs together.
_Avoid_: serial suite

**Deadline**:
The point shortly before Stryker's timeout at which the runner stops a mutant run itself.
_Avoid_: hard stop, runner timeout

**Run budget**:
The per-test timeout and the deadline that one run gets, derived from Stryker's timeout for a mutant run and
from the Playwright config for the dry run.
_Avoid_: timeouts

### Coverage

**Static mutant**:
Stryker's static mutant, which it runs against every test: one that code outside any test reached, such as an
import, a `beforeAll` or `afterAll` hook or a fixture; under this runner, also one that a `webServer` request
reached while no test ran.
_Avoid_: global mutant, setup mutant

**Snapshot**:
One record of coverage and hit count that a page frame, a Playwright worker or a server request writes to
the run's folder, tagged with the test it belongs to.
_Avoid_: coverage dump, coverage file

**Page helpers**:
Stryker's per-file helper functions, which the runner defines in every page and frame so that a mutated
callback that Playwright sends to the page as source text can run there.
_Avoid_: init script, Stryker helpers

### Server support

**Server support**:
The mode, turned on by `lzPlaywright.webServer.mutate`, in which the `webServer` gets each run's mutant and
reports per-test coverage.
_Avoid_: server mode, server-side mutation

**Worker hook**:
The code that the runner loads into each Playwright worker to record the worker's and pages' coverage, set
the active mutant in pages, and tag requests with the test id header.
_Avoid_: worker plugin, page hook

**Server hook**:
The code that the runner loads into each Node.js process that the `webServer` command starts, to switch the
active mutant per request and record coverage per request.
_Avoid_: server plugin, server agent

**Control file**:
The file the runner writes before each run that tells the server hook the run's mutant and settings.
_Avoid_: mutant file, server config

**Test id header**:
The `x-lz-stryker-test` request header that carries the id of the test that sent a request to the
`webServer`, added only in the dry run under per-test coverage.
_Avoid_: test header

**Untagged request**:
A request that reaches the `webServer` without a test id header; its coverage counts for every test that ran
when it arrived, or as static when none did.
_Avoid_: anonymous request, headerless request

**Server-side mutant**:
A mutant that the `webServer` reached in the dry run.
_Avoid_: backend mutant

**Start-up code**:
`webServer` code that runs once, when the server starts or first loads a module, and so cannot switch
mutants per request.
_Avoid_: module scope, boot code

**Start-up mutant**:
A static server-side mutant, which the runner gives the `webServer` by restarting it with that mutant in its
environment.
_Avoid_: boot mutant

**Isolation**:
Restarting the `webServer` before a mutant run when that run or the one before it in the same process tests
a server-side mutant, so that no state of one run reaches the next.
_Avoid_: server reset, sandboxing

**Server mutants file**:
The file `.lz-playwright-server-mutants` in Stryker's sandbox, in which the dry run's process lists the
server-side mutants for the other test runner processes.
_Avoid_: mutant list

**Server move**:
Giving each `webServer` of a test runner process a free port, and pointing the port and URL settings that
name it at that port, so that each process switches its own server.
_Avoid_: port remap, port shift

**Configured port**:
The port that the Playwright config gives a `webServer`, before any server move.
_Avoid_: original port, base port

**Fallback**:
Under `mutate: 'auto'`, a test runner process that runs as with server support off because the setup cannot
work or the dry run reached no server-side mutant.
_Avoid_: degrade, auto-off

### Traces

**Survivor traces**:
The Playwright traces of every test attempt that ran against a surviving mutant, kept in one folder per
mutant under the `survivorTraces` folder.
_Avoid_: mutant traces, failure traces

**Traces index**:
The `index.html` that the `lz-playwright-traces` reporter writes in the `survivorTraces` folder: Stryker's
report with each survivor's traces and the command that runs it again.
_Avoid_: trace report
