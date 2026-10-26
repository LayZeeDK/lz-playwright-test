// SPIKE_BROKEN=1 gives TextLiteral a sample it cannot mutate, before the package's entry installs.
import { operators } from '../../packages/stryker-ui-mutators/src/operators.ts';

if (process.env.SPIKE_BROKEN === '1') {
  Object.assign(operators[0], { sample: 'export const a = 1;\n' });
}
