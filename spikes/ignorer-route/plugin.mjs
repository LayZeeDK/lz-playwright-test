// Spike: does an Ignore plugin factory that throws stop `stryker run`? SPIKE_MODE=throw makes it throw.
import { declareFactoryPlugin, PluginKind } from '@stryker-mutator/api/plugin';

function ignorer() {
  if (process.env.SPIKE_MODE === 'throw') {
    throw new Error('SPIKE-KEPT-ERROR from the ui-mutators ignorer');
  }

  return { shouldIgnore: () => undefined };
}
ignorer.inject = [];

export const strykerPlugins = [declareFactoryPlugin(PluginKind.Ignore, 'ui-mutators', ignorer)];
