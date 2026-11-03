// SPIKE_BROKEN=1 gives LzJsxTextLiteral a sample it cannot mutate, before the package's entry installs.
// The table is taken from beside the entry the package name resolves to, so the break reaches that copy.
const entry = import.meta.resolve('@layzee/stryker-jsx-mutators');
const { operators } = await import(new URL('operators.js', entry).href);

if (process.env.SPIKE_BROKEN === '1') {
  Object.assign(operators[0], { sample: 'export const a = 1;\n' });
}
