// Route 2: the config imports the package and lists nothing.
import './break.ts';
import '@layzee/stryker-ui-mutators';

export default {
  mutate: ['src.tsx'],
  testRunner: 'command',
  commandRunner: { command: 'node -e "process.exit(0)"' },
  concurrency: 1,
  reporters: ['json'],
  jsonReporter: { fileName: 'out/import/mutation.json' },
  tempDirName: 'out/.stryker-tmp',
};
