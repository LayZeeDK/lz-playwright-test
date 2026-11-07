// install() against a fake Instrumenter whose placer records nothing but its methods, and resolveFromCore against
// the installed instrumenter and against a fake one on disk whose Babel types lack a member.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { describe, it, type TestContext } from 'node:test';

import { types } from '@babel/core';

import {
  install,
  resolveFromCore,
  testedVersion,
  type Instrumenter,
  type MutantOrigin,
  type SourceFile,
} from '../src/install.ts';
import {
  babelTypeMembers,
  type NodeMutatorLike,
  type Mutator,
} from '../src/mutator.ts';
import type { MutantPlacerLike } from '../src/placer.ts';
import { exportedFunction } from './support/exports.ts';
import { instrumentFully } from './support/instrument-result.ts';
import { tempRoot, writeTree } from './support/temp-tree.ts';

const ownMark = Symbol.for('@layzee/stryker-jsx-mutators');
const strykerMutators = ['StringLiteral', 'BooleanLiteral'] as const;

function mutator(name: string): Mutator {
  return {
    name,
    sample: `export const ${name.toLowerCase()} = 1;\n`,
    rules: [],
  };
}

/** A fake instrumenter: each marked mutator not in `silent` makes one mutant in its own self-check file. */
function setup({
  silent = [],
  version = testedVersion,
}: {
  readonly silent?: readonly string[];
  readonly version?: string;
} = {}) {
  const allMutators: NodeMutatorLike[] = strykerMutators.map((name) => ({
    name,
    mutate: () => [],
  }));
  const expressionPlacer: MutantPlacerLike = {
    name: 'expressionMutantPlacer',
    canPlace: () => false,
    place: () => undefined,
  };
  const instrumented: SourceFile[][] = [];
  const warnings: string[] = [];
  const instrumenter: Instrumenter = {
    dir: '/stryker/instrumenter',
    version,
    types,
    allMutators,
    expressionPlacer: { target: expressionPlacer, original: expressionPlacer },
    async instrument(files) {
      instrumented.push([...files]);

      return allMutators
        .filter(
          (mutator) => ownMark in mutator && !silent.includes(mutator.name),
        )
        .map((mutator) => ({
          fileName: `${mutator.name}.self-check.tsx`,
          mutatorName: mutator.name,
        }));
    },
  };
  const run = (mutators: Mutator[], target: Instrumenter = instrumenter) =>
    install(
      mutators,
      async () => target,
      (message) => warnings.push(message),
    );
  const names = () => allMutators.map(({ name }) => name);

  return { instrumenter, expressionPlacer, run, names, instrumented, warnings };
}

describe('install', () => {
  it("adds the mutators after Stryker's mutators, and instruments each one's sample as <name>.self-check.tsx", async () => {
    const { run, names, instrumented, warnings } = setup();

    await run([mutator('Alpha'), mutator('Beta')]);

    assert.deepEqual(names(), [...strykerMutators, 'Alpha', 'Beta']);
    assert.deepEqual(instrumented, [
      [
        { name: 'Alpha.self-check.tsx', content: 'export const alpha = 1;\n' },
        { name: 'Beta.self-check.tsx', content: 'export const beta = 1;\n' },
      ],
    ]);
    assert.deepEqual(warnings, []);
  });

  it('wraps the expression placer and marks it', async () => {
    const { run, expressionPlacer } = setup();
    const { canPlace, place } = expressionPlacer;

    await run([mutator('Alpha')]);

    assert.notEqual(expressionPlacer.canPlace, canPlace);
    assert.notEqual(expressionPlacer.place, place);
    assert.equal(ownMark in expressionPlacer, true);
  });

  it('adds nothing and wraps the placer once when it installs the same mutators again', async () => {
    const { run, names, expressionPlacer } = setup();

    await run([mutator('Alpha'), mutator('Beta')]);
    const { canPlace, place } = expressionPlacer;
    await run([mutator('Alpha'), mutator('Beta')]);

    assert.deepEqual(names(), [...strykerMutators, 'Alpha', 'Beta']);
    assert.equal(expressionPlacer.canPlace, canPlace);
    assert.equal(expressionPlacer.place, place);
  });

  it('adds only the missing mutator when a second install brings one more', async () => {
    const { run, names } = setup();

    await run([mutator('Alpha')]);
    await run([mutator('Alpha'), mutator('Beta')]);

    assert.deepEqual(names(), [...strykerMutators, 'Alpha', 'Beta']);
  });

  it('adds nothing and wraps once when a second copy of install.ts installs', async () => {
    const { run, names, instrumenter, expressionPlacer, warnings } = setup();
    // A query makes Node evaluate the file again as a separate module, as a second installed copy would be.
    const specifier = '../src/install.ts?copy';
    const copyInstall = exportedFunction(await import(specifier), 'install');

    await run([mutator('Alpha')]);
    const { canPlace } = expressionPlacer;
    await Reflect.apply(copyInstall, undefined, [
      [mutator('Alpha')],
      async () => instrumenter,
      (message: string) => warnings.push(message),
    ]);

    assert.deepEqual(names(), [...strykerMutators, 'Alpha']);
    assert.equal(expressionPlacer.canPlace, canPlace);
  });

  (
    [
      ["a name of Stryker's", [mutator('StringLiteral')], 'StringLiteral'],
      [
        "a name of Stryker's in another case",
        [mutator('stringliteral')],
        'stringliteral',
      ],
      [
        "two names of Stryker's",
        [mutator('BooleanLiteral'), mutator('Alpha'), mutator('StringLiteral')],
        'BooleanLiteral, StringLiteral',
      ],
      [
        'a name twice among its mutators',
        [mutator('Alpha'), mutator('Beta'), mutator('Alpha')],
        'Alpha',
      ],
      [
        'a name twice among its mutators in another case',
        [mutator('Alpha'), mutator('ALPHA')],
        'ALPHA',
      ],
    ] as const
  ).forEach(([title, mutators, taken]) => {
    it(`refuses ${title}, before it changes the list or the placer`, async () => {
      const { run, names, instrumented, expressionPlacer } = setup();
      const { canPlace } = expressionPlacer;

      await assert.rejects(run([...mutators]), {
        message: `@layzee/stryker-jsx-mutators: another mutator already has the name ${taken}.`,
      });

      assert.deepEqual(names(), strykerMutators);
      assert.deepEqual(instrumented, []);
      assert.equal(expressionPlacer.canPlace, canPlace);
      assert.equal(ownMark in expressionPlacer, false);
    });
  });

  it("treats a Stryker mutator whose name lowercases to one of this package's mutator names as a collision", async () => {
    const { run, instrumenter } = setup();
    const kelvinSign = '\u212A';
    instrumenter.allMutators.push({ name: kelvinSign, mutate: () => [] });

    await assert.rejects(run([mutator('k')]), {
      message:
        '@layzee/stryker-jsx-mutators: another mutator already has the name k.',
    });
  });

  it('does not count its own registered mutators as collisions on a second install', async () => {
    const { run, names } = setup();

    await run([mutator('Alpha')]);
    await run([mutator('Alpha')]);

    assert.deepEqual(names(), [...strykerMutators, 'Alpha']);
  });

  it('refuses a name that is not letters only, naming every such name, before it changes anything', async () => {
    const { run, names } = setup();

    await assert.rejects(
      run([
        mutator('Text1'),
        mutator('Alpha'),
        mutator('Text-Literal'),
        mutator(''),
      ]),
      {
        message:
          "@layzee/stryker-jsx-mutators: a mutator name has letters only, as Stryker's directives match no other character: " +
          '"Text1", "Text-Literal", ""',
      },
    );
    assert.deepEqual(names(), strykerMutators);
  });

  it('throws, naming the instrumenter version and dir and every mutator whose sample gave no mutant', async () => {
    const { run } = setup({ silent: ['Alpha', 'Gamma'] });

    await assert.rejects(
      run([mutator('Alpha'), mutator('Beta'), mutator('Gamma')]),
      {
        message:
          `@layzee/stryker-jsx-mutators: the instrumenter ${testedVersion} in /stryker/instrumenter made no mutants of Alpha, Gamma from ` +
          'their samples, so it does not run the mutators this module added. A bundled or second copy of the ' +
          'instrumenter does that.',
      },
    );
  });

  (
    [
      [
        'a mutant of a mutator only from its own sample file',
        { fileName: 'Other.self-check.tsx' },
      ],
      [
        'a mutant in the sample file of a mutator only when that mutator made it',
        { mutatorName: 'StringLiteral' },
      ],
    ] satisfies [string, Partial<MutantOrigin>][]
  ).forEach(([title, fields]) => {
    it(`counts ${title}`, async () => {
      const { run, instrumenter } = setup();
      const changed: Instrumenter = {
        ...instrumenter,
        async instrument(files) {
          const mutants = await instrumenter.instrument(files);

          return mutants.map((mutant) => ({ ...mutant, ...fields }));
        },
      };

      await assert.rejects(
        run([mutator('Alpha')], changed),
        /made no mutants of Alpha from their samples/,
      );
    });
  });

  ['10.1.2', '10.2.0', '110.1.1'].forEach((version) => {
    it(`warns about the instrumenter version ${version} after the self-check passed`, async () => {
      const { run, names, warnings } = setup({ version });

      await run([mutator('Alpha')]);

      assert.deepEqual(names(), [...strykerMutators, 'Alpha']);
      assert.deepEqual(warnings, [
        `@layzee/stryker-jsx-mutators was tested with @stryker-mutator/instrumenter ${testedVersion}, not ${version} in ` +
          '/stryker/instrumenter; its self-check passed.',
      ]);
    });
  });

  it('does not warn when the self-check fails, and the error names the version', async () => {
    const { run, warnings } = setup({ version: '10.2.0', silent: ['Alpha'] });

    await assert.rejects(
      run([mutator('Alpha')]),
      /the instrumenter 10\.2\.0 in \/stryker\/instrumenter made no mutants of Alpha/,
    );
    assert.deepEqual(warnings, []);
  });
});

describe('resolveFromCore', () => {
  it("returns the installed instrumenter, with Stryker's mutators, the expression placer and Babel 8 types", async () => {
    const instrumenter = await resolveFromCore();

    assert.equal(instrumenter.version, testedVersion);
    assert.ok(
      instrumenter.allMutators.some(({ name }) => name === 'StringLiteral'),
    );
    assert.equal(
      Reflect.get(instrumenter.expressionPlacer.target, 'name'),
      'expressionMutantPlacer',
    );
    assert.equal(
      instrumenter.types.isJSXText(instrumenter.types.jsxText('x')),
      true,
    );
    assert.match(
      instrumenter.dir,
      /[\\/]node_modules[\\/]@stryker-mutator[\\/]instrumenter$/,
    );
  });

  it('runs with excludedMutations, reporting those mutants as Ignored', async () => {
    const instrumenter = await resolveFromCore();
    const files = [{ name: 'sample.ts', content: "export const a = 'x';\n" }];

    const statuses = async (excluded?: string[]) =>
      (await instrumentFully(instrumenter, files, excluded)).mutants.map(
        ({ mutatorName, status }) => `${mutatorName} ${status ?? 'placed'}`,
      );

    assert.deepEqual(
      [await statuses(), await statuses(['StringLiteral'])],
      [['StringLiteral placed'], ['StringLiteral Ignored']],
    );
  });
});

describe('resolveFromCore against a fake instrumenter', () => {
  const placersFile = (placers: readonly string[]) =>
    `export const allMutantPlacers = [${placers.join(', ')}];`;
  const babel = import.meta.resolve('@babel/core');
  const babelFile = (members: string) =>
    `import { types as real } from ${JSON.stringify(babel)};\n` +
    `export const types = { ...real, ${members} };`;
  const placersPath =
    '@stryker-mutator/instrumenter/dist/src/mutant-placers/index.js';
  const indexPath = '@stryker-mutator/instrumenter/dist/src/index.js';
  const mutatorsPath =
    '@stryker-mutator/instrumenter/dist/src/mutators/mutate.js';
  const babelPath = '@babel/core/index.js';

  function fakeCore(
    t: TestContext,
    placers: readonly string[],
    replace: Readonly<Record<string, string>> = {},
  ) {
    const modules = join(tempRoot(t, 'jsx-mutators-core-'), 'node_modules');
    const dir = join(modules, '@stryker-mutator', 'instrumenter');
    const files: Record<string, string> = {
      '@stryker-mutator/core/package.json':
        '{ "name": "@stryker-mutator/core", "version": "9.9.9" }',
      '@stryker-mutator/instrumenter/package.json':
        '{ "name": "@stryker-mutator/instrumenter", "version": "9.9.8", "type": "module" }',
      [mutatorsPath]: 'export const allMutators = [];',
      [placersPath]: placersFile(
        placers.map(
          (name) =>
            `{ name: ${JSON.stringify(name)}, canPlace() { return false; }, place() {} }`,
        ),
      ),
      [indexPath]:
        'export const calls = [];\n' +
        'export class Instrumenter {\n' +
        '  constructor(logger) { this.logger = logger; }\n' +
        '  async instrument(files, options) {\n' +
        '    calls.push({ logger: this.logger, files, options });\n' +
        '    return { files: [], mutants: [] };\n' +
        '  }\n' +
        '}',
      '@babel/core/package.json':
        '{ "name": "@babel/core", "type": "module", "main": "index.js" }',
      [babelPath]: `export { types } from ${JSON.stringify(babel)};`,
      ...replace,
    };

    writeTree(modules, files);

    return {
      corePackage: join(modules, '@stryker-mutator', 'core', 'package.json'),
      dir,
      modules,
    };
  }

  (
    [
      [
        `Babel types with ${[...babelTypeMembers, 'react.buildChildren'].join(', ')}`,
        babelPath,
        'export const other = {};',
      ],
      ...babelTypeMembers.map(
        (member) =>
          [
            `Babel types with ${member}`,
            babelPath,
            babelFile(`${member}: 1`),
          ] as const,
      ),
      ...['react: null', 'react: {}', 'react: { buildChildren: 1 }'].map(
        (react) =>
          [
            'Babel types with react.buildChildren',
            babelPath,
            babelFile(react),
          ] as const,
      ),
    ] as const
  ).forEach(([missing, file, content]) => {
    it(`throws, naming the version and dir, when the instrumenter has no ${missing} (${content})`, async (t) => {
      const { corePackage, dir } = fakeCore(t, ['expressionMutantPlacer'], {
        [file]: content,
      });

      await assert.rejects(resolveFromCore(corePackage), {
        message: `@layzee/stryker-jsx-mutators: the instrumenter 9.9.8 in ${dir} has no ${missing}.`,
      });
    });
  });
});
