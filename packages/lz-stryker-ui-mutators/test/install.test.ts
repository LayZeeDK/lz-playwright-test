// install() against a fake Instrumenter whose placer records nothing but its methods, corePackageJson with injected
// realpath and resolve, and resolveFromCore against the installed instrumenter and against a fake one on disk.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, it } from 'node:test';
import { pathToFileURL } from 'node:url';

import {
  corePackageJson,
  install,
  resolveFromCore,
  TESTED_VERSION,
  type InstrumentedMutant,
  type Instrumenter,
  type SourceFile,
} from '../src/install.ts';
import type { BabelTypes, NodeMutatorLike, Operator } from '../src/mutator.ts';
import type { MutantPlacerLike } from '../src/placer.ts';

const OWN = Symbol.for('@layzee/lz-stryker-ui-mutators');
const LOCATION = { start: { line: 0, column: 0 }, end: { line: 0, column: 1 } };

function operator(name: string): Operator {
  return {
    name,
    sample: `export const ${name.toLowerCase()} = 1;\n`,
    rules: [],
  };
}

/** A fake instrumenter: each marked mutator not in `silent` makes one mutant in its own self-check file. */
function setup({
  builtIns = ['StringLiteral', 'BooleanLiteral'],
  silent = [] as string[],
  version = TESTED_VERSION,
} = {}) {
  const allMutators: NodeMutatorLike[] = builtIns.map((name) => ({
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
    types: {} as BabelTypes,
    allMutators,
    expressionPlacer,
    async instrument(files) {
      instrumented.push([...files]);
      const mutants = allMutators
        .filter((mutator) => OWN in mutator && !silent.includes(mutator.name))
        .map(
          (mutator): InstrumentedMutant => ({
            id: mutator.name,
            fileName: `${mutator.name}.self-check.tsx`,
            mutatorName: mutator.name,
            replacement: '',
            location: LOCATION,
          }),
        );

      return { files, mutants };
    },
  };
  const run = (operators: Operator[], target: Instrumenter = instrumenter) =>
    install(
      operators,
      async () => target,
      (message) => warnings.push(message),
    );
  const names = () => allMutators.map(({ name }) => name);

  return { instrumenter, expressionPlacer, run, names, instrumented, warnings };
}

describe('install', () => {
  it("adds the operators after Stryker's mutators, and instruments each one's sample as <name>.self-check.tsx", async () => {
    const { run, names, instrumented, warnings } = setup();

    await run([operator('Alpha'), operator('Beta')]);

    assert.deepEqual(names(), [
      'StringLiteral',
      'BooleanLiteral',
      'Alpha',
      'Beta',
    ]);
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

    await run([operator('Alpha')]);

    assert.notEqual(expressionPlacer.canPlace, canPlace);
    assert.notEqual(expressionPlacer.place, place);
    assert.equal(OWN in expressionPlacer, true);
  });

  it('adds nothing and wraps the placer once when it installs the same operators again', async () => {
    const { run, names, expressionPlacer } = setup();

    await run([operator('Alpha'), operator('Beta')]);
    const { canPlace, place } = expressionPlacer;
    await run([operator('Alpha'), operator('Beta')]);

    assert.deepEqual(names(), [
      'StringLiteral',
      'BooleanLiteral',
      'Alpha',
      'Beta',
    ]);
    assert.equal(expressionPlacer.canPlace, canPlace);
    assert.equal(expressionPlacer.place, place);
  });

  it('adds only the missing operator when a second install brings one more', async () => {
    const { run, names } = setup();

    await run([operator('Alpha')]);
    await run([operator('Alpha'), operator('Beta')]);

    assert.deepEqual(names(), [
      'StringLiteral',
      'BooleanLiteral',
      'Alpha',
      'Beta',
    ]);
  });

  it('adds nothing and wraps once when a second copy of install.ts installs', async () => {
    const { run, names, instrumenter, expressionPlacer, warnings } = setup();
    // A query makes Node evaluate the file again as a separate module, as a second installed copy would be.
    const specifier = '../src/install.ts?copy';
    const copy: { install: typeof install } = await import(specifier);

    await run([operator('Alpha')]);
    const { canPlace } = expressionPlacer;
    await copy.install(
      [operator('Alpha')],
      async () => instrumenter,
      (message) => warnings.push(message),
    );

    assert.deepEqual(names(), ['StringLiteral', 'BooleanLiteral', 'Alpha']);
    assert.equal(expressionPlacer.canPlace, canPlace);
  });

  for (const [title, operators, taken] of [
    ["a name of Stryker's", [operator('StringLiteral')], 'StringLiteral'],
    [
      "a name of Stryker's in another case",
      [operator('stringliteral')],
      'stringliteral',
    ],
    [
      "two names of Stryker's",
      [
        operator('BooleanLiteral'),
        operator('Alpha'),
        operator('StringLiteral'),
      ],
      'BooleanLiteral, StringLiteral',
    ],
    [
      'a name twice among its operators',
      [operator('Alpha'), operator('Beta'), operator('Alpha')],
      'Alpha',
    ],
    [
      'a name twice among its operators in another case',
      [operator('Alpha'), operator('ALPHA')],
      'ALPHA',
    ],
  ] as const) {
    it(`refuses ${title}, before it changes the list or the placer`, async () => {
      const { run, names, instrumented, expressionPlacer } = setup();
      const { canPlace } = expressionPlacer;

      await assert.rejects(run([...operators]), {
        message: `lz-stryker-ui-mutators: another mutator already has the name ${taken}.`,
      });

      assert.deepEqual(names(), ['StringLiteral', 'BooleanLiteral']);
      assert.deepEqual(instrumented, []);
      assert.equal(expressionPlacer.canPlace, canPlace);
      assert.equal(OWN in expressionPlacer, false);
    });
  }

  it('does not count its own registered operators as collisions on a second install', async () => {
    const { run, names } = setup();

    await run([operator('Alpha')]);
    await run([operator('Alpha')]);

    assert.deepEqual(names(), ['StringLiteral', 'BooleanLiteral', 'Alpha']);
  });

  it('refuses a name that is not letters only, naming every such name, before it changes anything', async () => {
    const { run, names } = setup();

    await assert.rejects(
      run([
        operator('Text1'),
        operator('Alpha'),
        operator('Text-Literal'),
        operator(''),
      ]),
      {
        message:
          "lz-stryker-ui-mutators: a mutator name has letters only, as Stryker's directives match no other character: " +
          '"Text1", "Text-Literal", ""',
      },
    );
    assert.deepEqual(names(), ['StringLiteral', 'BooleanLiteral']);
  });

  it('throws, naming the instrumenter version and dir and every operator whose sample gave no mutant', async () => {
    const { run } = setup({ silent: ['Alpha', 'Gamma'] });

    await assert.rejects(
      run([operator('Alpha'), operator('Beta'), operator('Gamma')]),
      {
        message:
          `lz-stryker-ui-mutators: the instrumenter ${TESTED_VERSION} in /stryker/instrumenter made no mutants of Alpha, Gamma from ` +
          'their samples, so it does not run the mutators this module added. A bundled or second copy of the ' +
          'instrumenter does that.',
      },
    );
  });

  it('counts a mutant of an operator only from its own sample file', async () => {
    const { run, instrumenter } = setup();
    const misplaced: Instrumenter = {
      ...instrumenter,
      async instrument(files) {
        const { mutants } = await instrumenter.instrument(files);

        return {
          files,
          mutants: mutants.map((mutant) => ({
            ...mutant,
            fileName: 'Other.self-check.tsx',
          })),
        };
      },
    };

    await assert.rejects(
      run([operator('Alpha')], misplaced),
      /made no mutants of Alpha from their samples/,
    );
  });

  for (const version of ['10.1.2', '10.2.0', '110.1.1']) {
    it(`warns about the instrumenter version ${version} after the self-check passed`, async () => {
      const { run, names, warnings } = setup({ version });

      await run([operator('Alpha')]);

      assert.deepEqual(names(), ['StringLiteral', 'BooleanLiteral', 'Alpha']);
      assert.deepEqual(warnings, [
        `lz-stryker-ui-mutators was tested with @stryker-mutator/instrumenter ${TESTED_VERSION}, not ${version} in ` +
          '/stryker/instrumenter; its self-check passed.',
      ]);
    });
  }

  it('does not warn when the self-check fails, and the error names the version', async () => {
    const { run, warnings } = setup({ version: '10.2.0', silent: ['Alpha'] });

    await assert.rejects(
      run([operator('Alpha')]),
      /the instrumenter 10\.2\.0 in \/stryker\/instrumenter made no mutants of Alpha/,
    );
    assert.deepEqual(warnings, []);
  });
});

describe('corePackageJson', () => {
  const CORE = join('/global', 'node_modules', '@stryker-mutator', 'core');
  const HERE = join(
    '/repo',
    'node_modules',
    '@stryker-mutator',
    'core',
    'package.json',
  );

  function coreFor(argv1: string, real: string | undefined): string {
    const realpaths: string[] = [];
    const core = corePackageJson(
      argv1,
      (path) => {
        realpaths.push(path);

        if (real === undefined) {
          throw new Error(
            `ENOENT: no such file or directory, realpath '${path}'`,
          );
        }

        return real;
      },
      (specifier) => {
        assert.equal(specifier, '@stryker-mutator/core/package.json');

        return HERE;
      },
    );

    assert.deepEqual(realpaths, [argv1]);

    return core;
  }

  it("takes the core whose bin started the process, through the bin's links", () => {
    assert.equal(
      coreFor('/usr/local/bin/stryker', join(CORE, 'bin', 'stryker.js')),
      join(CORE, 'package.json'),
    );
  });

  for (const [title, argv1, real] of [
    ['another script', '/repo/tools/run.ts', join('/repo', 'tools', 'run.ts')],
    [
      'a file next to the bin',
      '/usr/local/bin/stryker',
      join(CORE, 'bin', 'stryker.js.map'),
    ],
    [
      "another package's bin",
      '/usr/local/bin/stryker',
      join(
        '/global',
        'node_modules',
        '@stryker-mutator',
        'other',
        'bin',
        'stryker.js',
      ),
    ],
    ['a script path that does not resolve', '/missing', undefined],
  ] as const) {
    it(`takes the core this module resolves when the process runs ${title}`, () => {
      assert.equal(coreFor(argv1, real), HERE);
    });
  }

  // `undefined` passed in takes the default, process.argv[1], so only a process that runs no script has none.
  it('takes the core this module resolves, without a realpath, under node --eval', () => {
    const script =
      `import { corePackageJson } from ${JSON.stringify(pathToFileURL(join(import.meta.dirname, '..', 'src', 'install.ts')).href)};\n` +
      'const realpaths = [];\n' +
      "const core = corePackageJson(undefined, (path) => { realpaths.push(path); return path; }, () => 'here');\n" +
      'console.log(JSON.stringify({ core, realpaths }));\n';

    const child = spawnSync(
      process.execPath,
      ['--input-type=module', '--eval', script],
      { encoding: 'utf8' },
    );

    assert.equal(child.status, 0, child.stderr);
    assert.deepEqual(JSON.parse(child.stdout), { core: 'here', realpaths: [] });
  });
});

describe('resolveFromCore', () => {
  it("returns the installed instrumenter, with Stryker's mutators, the expression placer and Babel 8 types", async () => {
    const instrumenter = await resolveFromCore();

    assert.equal(instrumenter.version, TESTED_VERSION);
    assert.ok(
      instrumenter.allMutators.some(({ name }) => name === 'StringLiteral'),
    );
    assert.equal(instrumenter.expressionPlacer.name, 'expressionMutantPlacer');
    assert.equal(
      instrumenter.types.isJSXText(instrumenter.types.jsxText('x')),
      true,
    );
    assert.match(
      instrumenter.dir,
      /[\\/]node_modules[\\/]@stryker-mutator[\\/]instrumenter$/,
    );
  });

  it('instruments with excludedMutations, reporting those mutants as Ignored', async () => {
    const instrumenter = await resolveFromCore();
    const files = [{ name: 'sample.ts', content: "export const a = 'x';\n" }];

    const statuses = async (excluded?: string[]) =>
      (await instrumenter.instrument(files, excluded)).mutants.map(
        ({ mutatorName, status }) => `${mutatorName} ${status ?? 'placed'}`,
      );

    assert.deepEqual(
      [await statuses(), await statuses(['StringLiteral'])],
      [['StringLiteral placed'], ['StringLiteral Ignored']],
    );
  });
});

describe('resolveFromCore against a fake instrumenter', () => {
  const roots: string[] = [];

  after(() => {
    for (const root of roots) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  /**
   * A core, an instrumenter whose `Instrumenter.instrument` returns the logger and options it got, and a Babel core,
   * as node_modules under a fresh directory; `replace` swaps the content of any of those files. Returns core's
   * package.json and the instrumenter's dir.
   */
  function fakeCore(
    placers: readonly string[],
    replace: Readonly<Record<string, string>> = {},
  ) {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'ui-mutators-core-')));
    roots.push(root);
    const modules = join(root, 'node_modules');
    const dir = join(modules, '@stryker-mutator', 'instrumenter');
    const files: Record<string, string> = {
      '@stryker-mutator/core/package.json':
        '{ "name": "@stryker-mutator/core", "version": "9.9.9" }',
      '@stryker-mutator/instrumenter/package.json':
        '{ "name": "@stryker-mutator/instrumenter", "version": "9.9.8", "type": "module" }',
      '@stryker-mutator/instrumenter/dist/src/mutators/mutate.js':
        'export const allMutators = [];',
      '@stryker-mutator/instrumenter/dist/src/mutant-placers/index.js': `export const allMutantPlacers = ${JSON.stringify(
        placers.map((name) => ({ name })),
      )};`,
      '@stryker-mutator/instrumenter/dist/src/index.js':
        'export class Instrumenter {\n' +
        '  constructor(logger) { this.logger = logger; }\n' +
        '  async instrument(files, options) { return { files, mutants: [], logger: this.logger, options }; }\n' +
        '}',
      '@babel/core/package.json':
        '{ "name": "@babel/core", "type": "module", "main": "index.js" }',
      '@babel/core/index.js':
        "export const types = { fake: 'babel types', isJSXText: () => true };",
      ...replace,
    };

    for (const [name, content] of Object.entries(files)) {
      const path = join(modules, name);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content);
    }

    return {
      corePackage: join(modules, '@stryker-mutator', 'core', 'package.json'),
      dir,
    };
  }

  it('throws, naming the version and dir, when the instrumenter has no expressionMutantPlacer', async () => {
    const { corePackage, dir } = fakeCore(['otherPlacer']);

    await assert.rejects(resolveFromCore(corePackage), {
      message: `lz-stryker-ui-mutators: the instrumenter 9.9.8 in ${dir} has no expressionMutantPlacer.`,
    });
  });

  for (const [missing, file, content] of [
    [
      'allMutators',
      '@stryker-mutator/instrumenter/dist/src/mutators/mutate.js',
      'export const allMutators = {};',
    ],
    [
      'allMutantPlacers',
      '@stryker-mutator/instrumenter/dist/src/mutant-placers/index.js',
      'export const placers = [];',
    ],
    [
      'Instrumenter',
      '@stryker-mutator/instrumenter/dist/src/index.js',
      'export const Instrumenter = {};',
    ],
    [
      'Babel types',
      '@babel/core/index.js',
      "export const types = { fake: 'babel types' };",
    ],
    ['Babel types', '@babel/core/index.js', 'export const other = {};'],
  ] as const) {
    it(`throws, naming the version and dir, when the instrumenter has no ${missing} (${content})`, async () => {
      const { corePackage, dir } = fakeCore(['expressionMutantPlacer'], {
        [file]: content,
      });

      await assert.rejects(resolveFromCore(corePackage), {
        message: `lz-stryker-ui-mutators: the instrumenter 9.9.8 in ${dir} has no ${missing}.`,
      });
    });
  }

  it("takes the placer named expressionMutantPlacer, the instrumenter's version and its Babel's types", async () => {
    const { corePackage, dir } = fakeCore([
      'otherPlacer',
      'expressionMutantPlacer',
    ]);

    const instrumenter = await resolveFromCore(corePackage);

    assert.deepEqual(
      {
        dir: instrumenter.dir,
        version: instrumenter.version,
        types: Object.keys(instrumenter.types),
        placer: instrumenter.expressionPlacer,
      },
      {
        dir,
        version: '9.9.8',
        types: ['fake', 'isJSXText'],
        placer: { name: 'expressionMutantPlacer' },
      },
    );
  });

  it('instruments every file with mutate set, no plugins, no ignorers and no exclusions, through a silent logger', async () => {
    const { corePackage } = fakeCore(['expressionMutantPlacer']);
    const instrumenter = await resolveFromCore(corePackage);

    const result = (await instrumenter.instrument([
      { name: 'a.tsx', content: 'x' },
    ])) as unknown as {
      files: unknown;
      options: unknown;
      logger: Record<string, () => unknown>;
    };

    assert.deepEqual(result.files, [
      { name: 'a.tsx', content: 'x', mutate: true },
    ]);
    assert.deepEqual(result.options, {
      plugins: null,
      excludedMutations: [],
      ignorers: [],
    });
    assert.deepEqual(
      Object.entries(result.logger).map(([name, method]) => [name, method()]),
      [
        ['debug', undefined],
        ['info', undefined],
        ['warn', undefined],
        ['error', undefined],
        ['trace', undefined],
        ['fatal', undefined],
        ['isDebugEnabled', false],
        ['isTraceEnabled', false],
      ],
    );
  });
});
