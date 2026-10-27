// Child-process driver for index.test.ts. Argument `broken`: give LzTextLiteral a sample it cannot mutate first.
// Prints one JSON line: the names this package registered, whether the placer is wrapped, and the ignorer outcome.
import { resolveFromCore } from '../../src/install.ts';
import { operators } from '../../src/operators.ts';
import { defined } from '../support/defined.ts';

if (process.argv[2] === 'broken') {
  Object.assign(operators[0], { sample: 'export const a = 1;\n' });
}

const { strykerPlugins } = await import('../../src/index.ts');
const instrumenter = await resolveFromCore();
const own = Symbol.for('@layzee/lz-stryker-ui-mutators');
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
