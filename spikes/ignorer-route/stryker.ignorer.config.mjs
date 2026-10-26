export default {
  mutate: ['src.js'],
  plugins: ['./plugin.mjs'],
  ignorers: ['ui-mutators'],
  testRunner: 'command',
  commandRunner: { command: 'node -e "process.exit(0)"' },
  concurrency: 1,
  reporters: ['clear-text'],
  tempDirName: 'out/.stryker-tmp',
};
