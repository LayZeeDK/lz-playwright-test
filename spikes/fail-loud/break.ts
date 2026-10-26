// SPIKE_BROKEN=1 gives LzTextLiteral a sample it cannot mutate, before the package's entry installs.
import { operators } from '../../packages/lz-stryker-ui-mutators/dist/operators.js';

const patched = new URL('../../packages/lz-stryker-ui-mutators/dist/', import.meta.url).href;
const loaded = import.meta.resolve('@layzee/lz-stryker-ui-mutators');

if (!loaded.startsWith(patched)) {
  throw new Error(`break.ts patches ${patched}, but the package name loads ${loaded}; the break would not reach it.`);
}

if (process.env.SPIKE_BROKEN === '1') {
  Object.assign(operators[0], { sample: 'export const a = 1;\n' });
}
