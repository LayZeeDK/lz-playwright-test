import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isRecord } from './is-record.ts';
import { packageName } from './package-name.ts';

export interface ProjectLog {
  readonly info: (message: string) => void;
  readonly warn: (message: string) => void;
}

export interface StorybookProject {
  readonly configDir: string;
  readonly storyFiles: ReadonlySet<string> | 'fallback';
  readonly transformer: 'seen' | 'not-seen';
}

type LoadResult =
  | { readonly kind: 'loaded'; readonly storyFiles: readonly string[] }
  | { readonly kind: 'no-main' }
  | { readonly kind: 'failed'; readonly error: string };

const childFile = fileURLToPath(
  new URL(
    `./load-storybook.child${extname(fileURLToPath(import.meta.url))}`,
    import.meta.url,
  ),
);

export function storybookProject(
  configDir: string,
  log: ProjectLog,
): StorybookProject {
  const result = loadStorybook(configDir);

  switch (result.kind) {
    case 'loaded': {
      return {
        configDir,
        storyFiles: new Set(result.storyFiles),
        transformer: 'not-seen',
      };
    }
    case 'no-main': {
      log.info(
        `${packageName}: no Storybook main file in ${configDir}; story files are the files named *.stories.* or *.story.*`,
      );

      return fallbackProject(configDir);
    }
    case 'failed': {
      log.warn(
        `${packageName}: Storybook could not load ${configDir}, so story files are the files named *.stories.* or *.story.*: ${result.error}`,
      );

      return fallbackProject(configDir);
    }
  }
}

export function isStoryFile(
  project: StorybookProject,
  fileName: string,
): boolean {
  if (project.storyFiles === 'fallback') {
    return fileName.includes('.stories.') || fileName.includes('.story.');
  }

  return project.storyFiles.has(fileName.replaceAll('\\', '/'));
}

function fallbackProject(configDir: string): StorybookProject {
  return { configDir, storyFiles: 'fallback', transformer: 'not-seen' };
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
  const kind = isRecord(value) ? value['kind'] : undefined;
  const storyFiles = isRecord(value) ? value['storyFiles'] : undefined;
  const error = isRecord(value) ? value['error'] : undefined;

  if (
    kind === 'loaded' &&
    Array.isArray(storyFiles) &&
    storyFiles.every((file) => typeof file === 'string')
  ) {
    return { kind, storyFiles };
  }

  if (kind === 'no-main') {
    return { kind };
  }

  if (kind === 'failed' && typeof error === 'string') {
    return { kind, error };
  }

  throw new Error(
    `${packageName}: the Storybook loader wrote a result of an unknown shape`,
  );
}
