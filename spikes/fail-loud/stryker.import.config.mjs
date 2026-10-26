// Route 2: the config imports the package and lists nothing. break.ts has a top-level await, so a static
// import of the package beside it could start installing first; awaiting the package after it keeps the order.
import './break.ts';

await import('@layzee/lz-stryker-ui-mutators');

export default {
  mutate: ['src.tsx'],
  testRunner: 'command',
  commandRunner: { command: 'node -e "process.exit(0)"' },
  concurrency: 1,
  reporters: ['json'],
  jsonReporter: { fileName: 'out/import/mutation.json' },
  tempDirName: 'out/.stryker-tmp',
};
