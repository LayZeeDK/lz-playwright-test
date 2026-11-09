import { appendFileSync } from 'node:fs';
import { relative, sep } from 'node:path';

export const mockTransformerPluginName = 'lz-storybook-mock-transformer';

export const recordVariable = 'LZ_STRYKER_STORYBOOK_RECORD';

export function appendRecord(file: string, rewritten: number): void {
  const recordFile = process.env[recordVariable];

  if (recordFile === undefined) {
    return;
  }

  const projectFile = relative(process.cwd(), file).split(sep).join('/');
  appendFileSync(
    recordFile,
    `${JSON.stringify({ file: projectFile, rewritten })}\n`,
  );
}
