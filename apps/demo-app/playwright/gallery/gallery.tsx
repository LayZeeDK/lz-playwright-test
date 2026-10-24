import type { ComponentType } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';

import '../../src/styles.css';

type StoryModule = Record<string, ComponentType<Record<string, unknown>>>;

const storyFiles = import.meta.glob<StoryModule>('../../src/**/*.story.tsx');
let root: Root | undefined;

async function resolveStory(id: string) {
  const exportName = id.slice(id.lastIndexOf('/') + 1);
  const file = id.slice(0, id.lastIndexOf('/'));
  const matches = Object.keys(storyFiles).filter((key) =>
    key.replace(/^\.\.\/\.\.\/src\//, '').replace(/\.story\.tsx$/, '').endsWith(file),
  );

  if (matches.length !== 1) {
    throw new Error(`Story file for "${id}" matched ${matches.length} files`);
  }

  const Story = (await storyFiles[matches[0]]())[exportName];

  if (!Story) {
    throw new Error(`Story "${id}" has no export "${exportName}"`);
  }

  return Story;
}

Object.assign(window, {
  async mount({ story, props }: { story: string; props?: Record<string, unknown> }) {
    const Story = await resolveStory(story);
    root ??= createRoot(document.getElementById('root') as HTMLElement);
    flushSync(() => root!.render(<Story {...props} />));
  },
  unmount() {
    root?.unmount();
    root = undefined;
  },
});
