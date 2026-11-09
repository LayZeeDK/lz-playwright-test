import { fileURLToPath } from 'node:url';

export default {
  stories: ['../src/**/*.stories.tsx'],
  framework: fileURLToPath(new URL('../../framework', import.meta.url)),
  viteFinal: (config: { readonly plugins?: readonly unknown[] }) => ({
    ...config,
    plugins: [
      ...(config.plugins ?? []),
      [false, [{ name: 'lz-storybook-mock-transformer' }]],
    ],
  }),
};
