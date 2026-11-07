import { resolveFromCore } from '../../src/install.ts';
import { exportedFunction } from '../support/exports.ts';

const mode = process.argv[2];
const instrumenter = await resolveFromCore();

if (mode === 'taken') {
  instrumenter.allMutators.push({ name: 'LzJsxTextLiteral', mutate: () => [] });
}

const entry = await import('../../src/index.ts');

if (mode === 'install' || mode === 'taken') {
  await entry.lzJsxMutators();
}

if (mode === 'undefined-option') {
  await Reflect.apply(entry.lzJsxMutators, undefined, [
    { extended: undefined },
  ]);
}

const own = Symbol.for('@layzee/stryker-jsx-mutators');

const ignorers = entry.strykerPlugins.map((plugin) => {
  const ignorer: unknown = Reflect.apply(plugin.factory, undefined, [{}]);
  const outcome: unknown = Reflect.apply(
    exportedFunction(ignorer, 'shouldIgnore'),
    ignorer,
    [{}],
  );

  return `${plugin.kind} ${plugin.name} ${String(outcome)}`;
});

console.log(
  JSON.stringify({
    registered: instrumenter.allMutators
      .filter((mutator) => own in mutator)
      .map(({ name }) => name),
    placerWrapped: own in instrumenter.expressionPlacer.target,
    ignorers,
    schema: entry.strykerValidationSchema,
  }),
);
