import './rejects.mjs';

export default {
  mutate: ['src.js'],
  testRunner: 'command',
  commandRunner: { command: 'node -e "process.exit(0)"' },
  concurrency: 1,
  reporters: ['clear-text'],
  tempDirName: 'out/.stryker-tmp',
};
