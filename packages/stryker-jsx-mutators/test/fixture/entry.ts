// Prints one JSON line: the names this package registered, whether the placer is wrapped, each ignorer's outcome,
// and whether the entry exports the options schema.
import { resolveFromCore } from '../../src/install.ts';
import { strykerValidationSchema } from '../../src/styling-ignorer.ts';
import { exportedFunction } from '../support/exports.ts';

const instrumenter = await resolveFromCore();

if (process.argv[2] === 'taken') {
  instrumenter.allMutators.push({ name: 'LzJsxTextLiteral', mutate: () => [] });
}

const entry = await import('../../src/index.ts');
const own = Symbol.for('@layzee/stryker-jsx-mutators');

const ignorers = entry.strykerPlugins.map((plugin) => {
  try {
    const ignorer: unknown = Reflect.apply(plugin.factory, undefined, [{}]);
    const outcome: unknown = Reflect.apply(
      exportedFunction(ignorer, 'shouldIgnore'),
      ignorer,
      [{}],
    );

    return `${plugin.kind} ${plugin.name} ${String(outcome)}`;
  } catch (error) {
    return `${plugin.name} throws ${error instanceof Error ? error.message : String(error)}`;
  }
});

console.log(
  JSON.stringify({
    registered: instrumenter.allMutators
      .filter((mutator) => own in mutator)
      .map(({ name }) => name),
    placerWrapped: own in instrumenter.expressionPlacer.target,
    ignorers,
    schema: entry.strykerValidationSchema === strykerValidationSchema,
  }),
);
