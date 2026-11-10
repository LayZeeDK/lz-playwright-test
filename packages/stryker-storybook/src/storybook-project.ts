import { execFileSync } from 'node:child_process';
import { globSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getInterpretedFile } from 'storybook/internal/common';
import { loadConfig } from 'storybook/internal/csf-tools';

import { isRecord, isStringArray } from './is-record.ts';
import type { LoadResult } from './loader-result.ts';
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

type VitestTags =
  | {
      readonly kind: 'resolved';
      readonly tags: Omit<TestTags, 'previewTags'>;
    }
  | { readonly kind: 'failed'; readonly error: string }
  | { readonly kind: 'no-vitest' }
  | { readonly kind: 'unreadable' };

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
  const { test: previewTest, tags: previewTags } = readPreview(configDir, log);

  const testTags = {
    ...tagFilter(vitestTags, vitestConfigFile, log),
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

function tagFilter(
  vitestTags: VitestTags,
  vitestConfigFile: string | undefined,
  log: ProjectLog,
): Omit<TestTags, 'previewTags'> {
  switch (vitestTags.kind) {
    case 'resolved': {
      return vitestTags.tags;
    }
    case 'failed': {
      log.warn(
        `${packageName}: Vitest could not load ${vitestConfigFile ?? `its config from ${process.cwd()}`}, so the tested stories are the stories tagged test: ${vitestTags.error}`,
      );

      return defaultTestTags;
    }
    case 'no-vitest': {
      log.warn(
        `${packageName}: Vitest is not installed, so the tested stories are the stories tagged test`,
      );

      return defaultTestTags;
    }
    case 'unreadable': {
      log.warn(
        `${packageName}: the Storybook loader wrote a tag filter of an unknown shape, so the tested stories are the stories tagged test`,
      );

      return defaultTestTags;
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

/** The tags are read as Storybook 10.6.5 vitest-plugin index.ts `extractTagsFromPreview` reads them. */
function readPreview(
  configDir: string,
  log: ProjectLog,
): { readonly test: ResetSettings; readonly tags: readonly string[] } {
  const file = getInterpretedFile(join(configDir, 'preview'));

  if (file === undefined) {
    return { test: {}, tags: [] };
  }

  try {
    const code = readFileSync(file, 'utf8');
    const tags: unknown = loadConfig(code, file)
      .parse()
      .getFieldValue(['tags']);

    return {
      test: readPreviewTest(parseProgram(code, file)),
      tags: isStringArray(tags) ? tags : [],
    };
  } catch (error) {
    log.warn(
      `${packageName}: could not parse ${file}, so its parameters.test is unknown and its tags are left out: ${String(error)}`,
    );

    return { test: unreadableSettings, tags: [] };
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

    return parseLoaderResult(JSON.parse(readFileSync(resultFile, 'utf8')));
  } finally {
    rmSync(resultDir, { recursive: true, force: true });
  }
}

/** Parses the result file of the Storybook loader child, which `LoaderResult` describes. */
export function parseLoaderResult(value: unknown): {
  readonly storybook: LoadResult;
  readonly vitestTags: VitestTags;
} {
  return {
    storybook: parseResult(value),
    vitestTags: parseTestTags(field(value, 'testTags')),
  };
}

function parseTestTags(value: unknown): VitestTags {
  const kind = field(value, 'kind');
  const error = field(value, 'error');

  if (kind === 'failed' && typeof error === 'string') {
    return { kind, error };
  }

  if (kind === 'no-vitest') {
    return { kind };
  }

  const values = ['include', 'exclude', 'skip'].map((key) => field(value, key));

  if (
    kind !== 'resolved' ||
    !values.every((tags) => tags === undefined || typeof tags === 'string')
  ) {
    return { kind: 'unreadable' };
  }

  const [include, exclude, skip] = values.map((tags) =>
    typeof tags === 'string' ? tags.split(',').filter(Boolean) : undefined,
  );

  return {
    kind: 'resolved',
    tags: {
      include: include ?? defaultTestTags.include,
      exclude: exclude ?? [],
      skip: skip ?? [],
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
