// Prints one JSON line: the names this package registered, whether the placer is wrapped, and the ignorer outcome.
import { resolveFromCore } from '../../src/install.ts';
import { defined } from '../support/defined.ts';

const instrumenter = await resolveFromCore();

if (process.argv[2] === 'taken') {
  instrumenter.allMutators.push({ name: 'LzJsxTextLiteral', mutate: () => [] });
}

const { strykerPlugins } = await import('../../src/index.ts');
const own = Symbol.for('@layzee/stryker-playwright-mutators');
let ignorer: string;

try {
  const plugin = defined(strykerPlugins[0]);
  ignorer = `${plugin.kind} ${plugin.name} ${String(plugin.factory().shouldIgnore({}))}`;
} catch (error) {
  ignorer = `throws ${error instanceof Error ? error.message : String(error)}`;
}

console.log(
  JSON.stringify({
    registered: instrumenter.allMutators
      .filter((mutator) => own in mutator)
      .map(({ name }) => name),
    placerWrapped: own in instrumenter.expressionPlacer.target,
    ignorer,
  }),
);
