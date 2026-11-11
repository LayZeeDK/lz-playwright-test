# In a story file, story data is app code and play functions are test code

Lars: "To many component UI libraries, thier \*.stories.\* files are their equivalent to app code." Their args,
render functions and meta describe the components, while their play functions, `.test()` bodies, story hooks and msw
handlers are tests. The `lz-storybook-csf` ignorer takes one option for this, `lzStorybookCsf.play`: `'ignore'`, the
default, keeps the test parts' mutants out of a config that mutates app code, and `'mutate'` also keeps the test
parts' mutants, for a config that mutates test code; only static CSF values stay ignored in both modes. Lars
approved a separate Stryker config whose `mutate` lists the story files "as the canonical, fully and officially
supported path."

## Considered Options

- Leave story files out of both configs. Then the args and render code of a component library that has no other app
  code gets no mutants at all.

## Consequences

- When both an app-code config and a test-code config list the same story files, the story-data mutants run in
  both.
