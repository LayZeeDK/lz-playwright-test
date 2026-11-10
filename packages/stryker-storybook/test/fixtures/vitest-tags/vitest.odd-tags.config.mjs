import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    env: {
      __STORYBOOK_URL__: 'http://localhost:6006',
      __VITEST_INCLUDE_TAGS__: 5,
    },
  },
});
