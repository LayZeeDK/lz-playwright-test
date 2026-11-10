/** What the Storybook loader child writes to its result file; the parent still parses it, as it crosses a process boundary. */
export type LoaderResult = LoadResult & { readonly testTags: LoaderTestTags };

export type LoadResult =
  | {
      readonly kind: 'loaded';
      readonly storyFiles: readonly string[];
      readonly pluginNames: readonly string[];
    }
  | { readonly kind: 'no-main' }
  | { readonly kind: 'failed'; readonly error: string };

/** The env values that storybookTest() sets, as Vitest resolved them; a field is missing when no project runs storybookTest(). */
export type LoaderTestTags =
  | {
      readonly kind: 'resolved';
      readonly include: unknown;
      readonly exclude: unknown;
      readonly skip: unknown;
    }
  | { readonly kind: 'failed'; readonly error: string }
  | { readonly kind: 'no-vitest' };
