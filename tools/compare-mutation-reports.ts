// Compares the mutants of two Stryker mutation.json reports: id, file name, start position, mutator and
// replacement, and with --status their statuses too. File names drop the folders, so a project that keeps the
// same files elsewhere (tools/packed-demo) compares with the workspace. Mutator names match with or without
// the Lz prefix of the UI operators, so a report from before the lz- rename compares with one after it.
// Exits 0 when both list the same mutants.
// Run: node tools/compare-mutation-reports.ts <a/mutation.json> <b/mutation.json> [--status]
import { readFileSync } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const withStatus = args.includes('--status');
const [first, second] = args.filter((arg) => arg !== '--status');

if (!first || !second) {
  throw new Error(
    'Usage: node tools/compare-mutation-reports.ts <a/mutation.json> <b/mutation.json> [--status]',
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown, what: string): string {
  if (typeof value !== 'string') {
    throw new Error(`${what} is not a string`);
  }

  return value;
}

function mutantKeys(reportPath: string): string[] {
  const report: unknown = JSON.parse(readFileSync(reportPath, 'utf8'));

  if (!isRecord(report) || !isRecord(report['files'])) {
    throw new Error(`${reportPath} has no files object`);
  }

  const keys: string[] = [];

  for (const [file, entry] of Object.entries(report['files'])) {
    const mutants = isRecord(entry) ? entry['mutants'] : undefined;

    if (!Array.isArray(mutants)) {
      throw new Error(`${reportPath}: ${file} has no mutants array`);
    }

    for (const mutant of mutants) {
      const location = isRecord(mutant) ? mutant['location'] : undefined;
      const start = isRecord(location) ? location['start'] : undefined;

      if (!isRecord(mutant) || !isRecord(start)) {
        throw new Error(`${reportPath}: ${file} has a mutant without a start`);
      }

      const fields = [
        text(mutant['id'], 'a mutant id'),
        path.basename(file),
        `${String(start['line'])}:${String(start['column'])}`,
        text(mutant['mutatorName'], 'a mutator name').replace(/^Lz/, ''),
        (typeof mutant['replacement'] === 'string'
          ? mutant['replacement']
          : ''
        ).replace(/\s+/g, ' '),
      ];

      if (withStatus) {
        fields.push(text(mutant['status'], 'a status'));
      }

      keys.push(fields.join(' | '));
    }
  }

  return keys;
}

const a = new Set(mutantKeys(first));
const b = new Set(mutantKeys(second));
const onlyA = [...a].filter((key) => !b.has(key));
const onlyB = [...b].filter((key) => !a.has(key));

console.log(
  `${a.size} and ${b.size} mutants; ${onlyA.length} only in the first, ${onlyB.length} only in the second`,
);

for (const key of onlyA) {
  console.log(`- ${key}`);
}

for (const key of onlyB) {
  console.log(`+ ${key}`);
}

process.exitCode = onlyA.length + onlyB.length === 0 ? 0 : 1;
