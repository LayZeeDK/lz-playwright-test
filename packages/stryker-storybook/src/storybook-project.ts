import { execFileSync } from 'node:child_process';
import { globSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getInterpretedFile } from 'storybook/internal/common';

import { isRecord } from './is-record.ts';
import { packageName } from './package-name.ts';
import { parseProgram } from './parse.ts';
import { readPreviewTest, type ResetSettings } from './reset-setting.ts';
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
}

type LoadResult =
  | {
      readonly kind: 'loaded';
      readonly storyFiles: readonly string[];
      readonly pluginNames: readonly string[];
    }
  | { readonly kind: 'no-main' }
  | { readonly kind: 'failed'; readonly error: string };

const childFile = fileURLToPath(
  new URL(
    `./load-storybook.child${extname(fileURLToPath(import.meta.url))}`,
    import.meta.url,
  ),
);

const projects = new Map<string, StorybookProject>();

export function storybookProject(
  givenConfigDir: string,
  log: ProjectLog,
): StorybookProject {
  const configDir = resolve(givenConfigDir);
  const project = projects.get(configDir) ?? loadProject(configDir, log);
  projects.set(configDir, project);

  return project;
}

function loadProject(configDir: string, log: ProjectLog): StorybookProject {
  const result = loadStorybook(configDir);
  const previewTest = readPreview(configDir);

  switch (result.kind) {
    case 'loaded': {
      return {
        configDir,
        storyFiles: new Set(result.storyFiles.map(normalizePath)),
        transformer: result.pluginNames.includes(mockTransformerPluginName)
          ? 'seen'
          : 'not-seen',
        previewTest,
      };
    }
    case 'no-main': {
      log.info(
        `${packageName}: no Storybook main file in ${configDir}; story files are the files named *.stories.* or *.story.*`,
      );

      return fallbackProject(configDir, previewTest);
    }
    case 'failed': {
      log.warn(
        `${packageName}: Storybook could not load ${configDir}, so story files are the files named *.stories.* or *.story.*: ${result.error}`,
      );

      return fallbackProject(configDir, previewTest);
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
): StorybookProject {
  return {
    configDir,
    storyFiles: 'fallback',
    transformer: 'not-seen',
    previewTest,
  };
}

function readPreview(configDir: string): ResetSettings {
  const file = getInterpretedFile(join(configDir, 'preview'));

  if (file === undefined) {
    return {};
  }

  try {
    return readPreviewTest(parseProgram(readFileSync(file, 'utf8'), file));
  } catch {
    return 'unreadable';
  }
}

function loadStorybook(configDir: string): LoadResult {
  const resultDir = mkdtempSync(join(tmpdir(), 'lz-storybook-'));
  const resultFile = join(resultDir, 'result.json');

  try {
    execFileSync(process.execPath, [childFile, configDir, resultFile], {
      stdio: 'ignore',
    });

    return parseResult(JSON.parse(readFileSync(resultFile, 'utf8')));
  } finally {
    rmSync(resultDir, { recursive: true, force: true });
  }
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
