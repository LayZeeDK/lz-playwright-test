// Shared by the runner (ESM), the reporter and the worker hook (both loaded by Playwright as CJS),
// so the id a test reports and the id its coverage is keyed by can never drift apart.
const SEPARATOR = ' › ';

/**
 * @param {{ project: string, file: string, line: number, column: number, titlePath: string[] }} test
 * `file` is relative to the Playwright rootDir with forward slashes.
 */
function formatTestId({ project, file, line, column, titlePath }) {
  return [`[${project}]`, `${file}:${line}:${column}`, ...titlePath].join(SEPARATOR);
}

/** @param {string} id */
function parseTestId(id) {
  const match = /^\[(.*?)\] › (.+):(\d+):(\d+)(?: › |$)/.exec(id);

  if (!match) {
    throw new Error(`Not a Playwright test id: ${id}`);
  }

  return { project: match[1], file: match[2], line: Number(match[3]), column: Number(match[4]) };
}

module.exports = { formatTestId, parseTestId };
