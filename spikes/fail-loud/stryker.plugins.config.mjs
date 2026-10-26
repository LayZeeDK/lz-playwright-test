// Route 1: the package in `plugins`, its ignorer in `ignorers`. The import only breaks a sample when asked.
import './break.ts';

export default {
  mutate: ['src.tsx'],
  plugins: ['@layzee/lz-stryker-ui-mutators'],
  ignorers: ['lz-stryker-ui-mutators'],
  testRunner: 'command',
  commandRunner: { command: 'node -e "process.exit(0)"' },
  concurrency: 1,
  reporters: ['json'],
  jsonReporter: { fileName: 'out/plugins/mutation.json' },
  tempDirName: 'out/.stryker-tmp',
};
