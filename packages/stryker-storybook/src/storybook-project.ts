import { execFileSync } from 'node:child_process';
import { globSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getInterpretedFile } from 'storybook/internal/common';
import { loadConfig } from 'storybook/internal/csf-tools';

import { isRecord } from './is-record.ts';
import { field } from './node-field.ts';
import { lzStorybookOptions, vitestConfigFile } from './options.ts';
import { packageName } from './package-name.ts';
import { parseProgram } from './parse.ts';
import {
  defaultTestTags,
  readPreviewTest,
  unreadableSettings,
  type ResetSettings,
  type TestTags,
} from './reset-setting.ts';
import { mockTransformerPluginName } from './stryker-record.ts';

export interface ProjectLog {
  readonly info: (message: string) => void;
  readonly warn: (message: string) => void;
}

export interface StorybookProject {
  readonly configDir: string;
  readonly storyFiles: ReadonlySet<string> | 'fallback';
  readonly transformer: 'seen' | 'not-seen';
  readonly previewTest: ResetSettings;
  readonly testTags: TestTags;
}

type LoadResult =
  | {
      readonly kind: 'loaded';
      readonly storyFiles: readonly string[];
      readonly pluginNames: readonly string[];
    }
  | { readonly kind: 'no-main' }
  | { readonly kind: 'failed'; readonly error: string };

type VitestTags =
  | {
      readonly kind: 'resolved';
      readonly tags: Omit<TestTags, 'previewTags'>;
    }
  | { readonly kind: 'failed'; readonly error: string };

const childFile = fileURLToPath(
  new URL(
    `./load-storybook.child${extname(fileURLToPath(import.meta.url))}`,
    import.meta.url,
  ),
);

const projects = new Map<string, StorybookProject>();

export function strykerStorybookProject(
  options: object,
  log: ProjectLog,
): StorybookProject {
  return storybookProject(
    lzStorybookOptions(options).configDir,
    log,
    vitestConfigFile(options),
  );
}

/** `vitestConfigFile` is Stryker's `vitest.configFile`; without it, Vitest looks the config up from the working directory, as Stryker's Vitest runner does. */
export function storybookProject(
  givenConfigDir: string,
  log: ProjectLog,
  vitestConfigFile?: string,
): StorybookProject {
  const configDir = resolve(givenConfigDir);
  const key = `${configDir}\0${vitestConfigFile ?? ''}`;
  const project =
    projects.get(key) ?? loadProject(configDir, vitestConfigFile, log);
  projects.set(key, project);

  return project;
}

function loadProject(
  configDir: string,
  vitestConfigFile: string | undefined,
  log: ProjectLog,
): StorybookProject {
  const { storybook: result, vitestTags } = loadStorybook(
    configDir,
    vitestConfigFile,
  );
  const previewTest = readPreview(configDir);
  const previewTags = readPreviewTags(configDir);

  if (vitestTags.kind === 'failed') {
    log.warn(
      `${packageName}: Vitest could not load ${vitestConfigFile ?? `its config from ${process.cwd()}`}, so the tested stories are the stories tagged test: ${vitestTags.error}`,
    );
  }

  const testTags = {
    ...(vitestTags.kind === 'resolved' ? vitestTags.tags : defaultTestTags),
    previewTags,
  };

  switch (result.kind) {
    case 'loaded': {
      return {
        configDir,
        storyFiles: new Set(result.storyFiles.map(normalizePath)),
        transformer: result.pluginNames.includes(mockTransformerPluginName)
          ? 'seen'
          : 'not-seen',
        previewTest,
        testTags,
      };
    }
    case 'no-main': {
      log.info(
        `${packageName}: no Storybook main file in ${configDir}; story files are the files named *.stories.* or *.story.*`,
      );

      return fallbackProject(configDir, previewTest, testTags);
    }
    case 'failed': {
      log.warn(
        `${packageName}: Storybook could not load ${configDir}, so story files are the files named *.stories.* or *.story.*: ${result.error}`,
      );

      return fallbackProject(configDir, previewTest, testTags);
    }
  }
}

export function isStoryFile(
  project: StorybookProject,
  fileName: string,
): boolean {
  if (project.storyFiles === 'fallback') {
    return /\.(?:stories|story)\./.test(basename(fileName));
  }

  return project.storyFiles.has(normalizePath(fileName));
}

export function storyFilePaths(project: StorybookProject): readonly string[] {
  return project.storyFiles === 'fallback'
    ? globSync('**/*', {
        exclude: (path) => basename(path) === 'node_modules',
      })
        .map((file) => resolve(file))
        .filter((file) => isStoryFile(project, file))
    : [...project.storyFiles];
}

function normalizePath(path: string): string {
  return path
    .replaceAll('\\', '/')
    .replace(/^[a-z]:/, (drive) => drive.toUpperCase());
}

function fallbackProject(
  configDir: string,
  previewTest: ResetSettings,
  testTags: TestTags,
): StorybookProject {
  return {
    configDir,
    storyFiles: 'fallback',
    transformer: 'not-seen',
    previewTest,
    testTags,
  };
}

/** Storybook 10.6.5 vitest-plugin index.ts `extractTagsFromPreview`. */
function readPreviewTags(configDir: string): readonly string[] {
  const file = getInterpretedFile(join(configDir, 'preview'));

  if (file === undefined) {
    return [];
  }

  try {
    const tags: unknown = loadConfig(readFileSync(file, 'utf8'), file)
      .parse()
      .getFieldValue(['tags']);

    return isStringArray(tags) ? tags : [];
  } catch {
    return [];
  }
}

function readPreview(configDir: string): ResetSettings {
  const file = getInterpretedFile(join(configDir, 'preview'));

  if (file === undefined) {
    return {};
  }

  try {
    return readPreviewTest(parseProgram(readFileSync(file, 'utf8'), file));
  } catch {
    return unreadableSettings;
  }
}

function loadStorybook(
  configDir: string,
  vitestConfigFile: string | undefined,
): { readonly storybook: LoadResult; readonly vitestTags: VitestTags } {
  const resultDir = mkdtempSync(join(tmpdir(), 'lz-storybook-'));
  const resultFile = join(resultDir, 'result.json');

  try {
    execFileSync(
      process.execPath,
      [
        childFile,
        configDir,
        resultFile,
        ...(vitestConfigFile === undefined ? [] : [vitestConfigFile]),
      ],
      { stdio: 'ignore' },
    );
    const value: unknown = JSON.parse(readFileSync(resultFile, 'utf8'));

    return {
      storybook: parseResult(value),
      vitestTags: parseTestTags(field(value, 'testTags')),
    };
  } finally {
    rmSync(resultDir, { recursive: true, force: true });
  }
}

function parseTestTags(value: unknown): VitestTags {
  const error = field(value, 'error');

  if (field(value, 'kind') === 'failed' && typeof error === 'string') {
    return { kind: 'failed', error };
  }

  const tagList = (key: string): readonly string[] | undefined => {
    const tags = field(value, key);

    return typeof tags === 'string' ? tags.split(',').filter(Boolean) : undefined;
  };

  return {
    kind: 'resolved',
    tags: {
      include: tagList('include') ?? defaultTestTags.include,
      exclude: tagList('exclude') ?? [],
      skip: tagList('skip') ?? [],
    },
  };
}

function parseResult(value: unknown): LoadResult {
  if (isRecord(value)) {
    const { kind, storyFiles, pluginNames, error } = value;

    if (
      kind === 'loaded' &&
      isStringArray(storyFiles) &&
      isStringArray(pluginNames)
    ) {
      return { kind, storyFiles, pluginNames };
    }

    if (kind === 'no-main') {
      return { kind };
    }

    if (kind === 'failed' && typeof error === 'string') {
      return { kind, error };
    }
  }

  throw new Error(
    `${packageName}: the Storybook loader wrote a result of an unknown shape`,
  );
}

function isStringArray(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === 'string')
  );
}
