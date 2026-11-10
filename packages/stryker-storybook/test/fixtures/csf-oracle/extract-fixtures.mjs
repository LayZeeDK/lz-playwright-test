// Regenerates fixtures.json from Storybook's CsfFile.test.ts and vitest-plugin/transformer.test.ts at one tag.
// Usage: node extract-fixtures.mjs <storybook clone> <tag> <out.json>
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const [clone, tag, out] = process.argv.slice(2);
const { parse } = createRequire(import.meta.url)('@babel/parser');
const plugins = ['typescript', 'jsx', 'decorators-legacy'];
const files = [
  'code/core/src/csf-tools/CsfFile.test.ts',
  'code/core/src/csf-tools/vitest-plugin/transformer.test.ts',
];
const show = (path) =>
  execFileSync('git', ['show', `${tag}:${path}`], {
    cwd: clone,
    encoding: 'utf8',
  });
const result = {
  source: {
    repository: 'storybookjs/storybook',
    tag,
    files,
    license: show('LICENSE'),
  },
  fixtures: [],
};
const skipped = [];

files.forEach((file) => {
  const prefix = file.endsWith('transformer.test.ts')
    ? 'transformer'
    : 'CsfFile';

  walk(parse(show(file), { sourceType: 'module', plugins }).program, [], false);

  function walk(node, titles, inAssertion) {
    if (!node || typeof node.type !== 'string') {
      return;
    }

    if (node.type === 'CallExpression') {
      const callee = node.callee;
      const name =
        callee.type === 'Identifier' ? callee.name : callee.property?.name;
      const first = node.arguments[0];

      if (
        ['it', 'describe', 'test'].includes(name) &&
        first?.type === 'StringLiteral'
      ) {
        node.arguments
          .slice(1)
          .forEach((arg) => walk(arg, [...titles, first.value], inAssertion));

        return;
      }

      if (typeof name === 'string' && /^to(Match|Throw)/.test(name)) {
        walk(callee, titles, inAssertion);
        node.arguments.forEach((arg) => walk(arg, titles, true));

        return;
      }
    }

    if (node.type === 'TemplateLiteral' && !inAssertion) {
      if (node.expressions.length > 0) {
        skipped.push(
          `${file}: ${titles.join(' > ')} (template with expressions)`,
        );
      } else {
        consider(node.quasis[0].value.cooked, titles);
      }

      return;
    }

    Object.entries(node)
      .filter(([key]) => !['loc', 'start', 'end'].includes(key))
      .flatMap(([, value]) => (Array.isArray(value) ? value : [value]))
      .filter((child) => child && typeof child === 'object')
      .forEach((child) => walk(child, titles, inAssertion));
  }

  function consider(code, titles) {
    if (!/\bexport\b/.test(code)) {
      return;
    }

    try {
      parse(code, { sourceType: 'module', plugins });
    } catch {
      skipped.push(`${file}: ${titles.join(' > ')} (does not parse)`);

      return;
    }

    const base = `${prefix}: ${titles.join(' > ')}`;
    const count = result.fixtures.filter((fixture) =>
      fixture.name.startsWith(base),
    ).length;

    result.fixtures.push({
      name: count === 0 ? base : `${base} #${count + 1}`,
      code: dedent(code),
    });
  }
});

function dedent(code) {
  const lines = code
    .replace(/^\n/, '')
    .replace(/\n\s*$/, '')
    .split('\n');
  const indent = Math.min(
    ...lines
      .filter((line) => line.trim())
      .map((line) => line.match(/^ */)[0].length),
  );

  return `${lines.map((line) => line.slice(indent)).join('\n')}\n`;
}

writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
console.log(`${result.fixtures.length} fixtures`);
console.log(skipped.join('\n'));
