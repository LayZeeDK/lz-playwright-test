import { fileURLToPath } from 'node:url';

export default {
  stories: ['../src/**/*.mdx', '../src/**/*.stories.cts'],
  framework: fileURLToPath(new URL('../../framework', import.meta.url)),
};
