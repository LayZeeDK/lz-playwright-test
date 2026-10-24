// Playwright reporter that writes one JSON file the runner reads after the CLI exits.
const fs = require('node:fs');
const path = require('node:path');

const { formatTestId } = require('./test-id.cjs');

class StrykerReporter {
  tests = [];
  errors = [];

  printsToStdio() {
    return false;
  }

  onTestEnd(test, result) {
    const outcome = test.outcome();

    this.tests.push({
      id: formatTestId({
        project: test.parent.project()?.name ?? '',
        file: path.relative(process.cwd(), test.location.file).replaceAll('\\', '/'),
        line: test.location.line,
        column: test.location.column,
        titlePath: test.titlePath().slice(3),
      }),
      file: test.location.file,
      line: test.location.line,
      column: test.location.column,
      status: outcome === 'skipped' ? 'skipped' : outcome === 'unexpected' ? 'failed' : 'passed',
      duration: result.duration,
      error: result.error?.message,
    });
  }

  onError(error) {
    this.errors.push(error.message ?? String(error));
  }

  onEnd(result) {
    fs.writeFileSync(
      process.env.STRYKER_PW_REPORT_FILE,
      JSON.stringify({ status: result.status, tests: this.tests, errors: this.errors }),
    );
  }
}

module.exports = StrykerReporter;
