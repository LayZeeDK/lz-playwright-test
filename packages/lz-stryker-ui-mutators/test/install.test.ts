// install() against a fake Instrumenter whose placer records nothing but its methods, corePackageJson with injected
// realpath and resolve, and resolveFromCore against the installed instrumenter and against a fake one on disk.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, it, type TestContext } from 'node:test';
import { pathToFileURL } from 'node:url';

import { types } from '@babel/core';

import {
  corePackageJson,
  install,
  resolveFromCore,
  TESTED_VERSION,
  type InstrumentedMutant,
  type Instrumenter,
  type SourceFile,
} from '../src/install.ts';
import {
  babelTypeMembers,
  type NodeMutatorLike,
  type Operator,
} from '../src/mutator.ts';
import type { MutantPlacerLike } from '../src/placer.ts';
import { firstPath, parse } from './support/babel.ts';
import { exported, exportedFunction } from './support/exports.ts';
import { tempRoot, writeTree } from './support/temp-tree.ts';

const OWN = Symbol.for('@layzee/lz-stryker-ui-mutators');
const LOCATION = { start: { line: 0, column: 0 }, end: { line: 0, column: 1 } };
const strykerMutators = ['StringLiteral', 'BooleanLiteral'] as const;

function operator(name: string): Operator {
  return {
    name,
    sample: `export const ${name.toLowerCase()} = 1;\n`,
    rules: [],
  };
}

/** A fake instrumenter: each marked mutator not in `silent` makes one mutant in its own self-check file. */
function setup({
  silent = [],
  version = TESTED_VERSION,
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

    assert.deepEqual(names(), [...strykerMutators, 'Alpha', 'Beta']);
    assert.equal(expressionPlacer.canPlace, canPlace);
    assert.equal(expressionPlacer.place, place);
  });

  it('adds only the missing operator when a second install brings one more', async () => {
    const { run, names } = setup();

    await run([operator('Alpha')]);
    await run([operator('Alpha'), operator('Beta')]);

    assert.deepEqual(names(), [...strykerMutators, 'Alpha', 'Beta']);
  });

  it('adds nothing and wraps once when a second copy of install.ts installs', async () => {
    const { run, names, instrumenter, expressionPlacer, warnings } = setup();
    // A query makes Node evaluate the file again as a separate module, as a second installed copy would be.
    const specifier = '../src/install.ts?copy';
    const copyInstall = exportedFunction(await import(specifier), 'install');

    await run([operator('Alpha')]);
    const { canPlace } = expressionPlacer;
    await Reflect.apply(copyInstall, undefined, [
      [operator('Alpha')],
      async () => instrumenter,
      (message: string) => warnings.push(message),
    ]);

    assert.deepEqual(names(), [...strykerMutators, 'Alpha']);
    assert.equal(expressionPlacer.canPlace, canPlace);
  });

  (
    [
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
    ] as const
  ).forEach(([title, operators, taken]) => {
    it(`refuses ${title}, before it changes the list or the placer`, async () => {
      const { run, names, instrumented, expressionPlacer } = setup();
      const { canPlace } = expressionPlacer;

      await assert.rejects(run([...operators]), {
        message: `lz-stryker-ui-mutators: another mutator already has the name ${taken}.`,
      });

      assert.deepEqual(names(), strykerMutators);
      assert.deepEqual(instrumented, []);
      assert.equal(expressionPlacer.canPlace, canPlace);
      assert.equal(OWN in expressionPlacer, false);
    });
  });

  it("treats a Stryker mutator whose name lowercases to an operator's name as a collision", async () => {
    const { run, instrumenter } = setup();
    const kelvinSign = '\u212A';
    instrumenter.allMutators.push({ name: kelvinSign, mutate: () => [] });

    await assert.rejects(run([operator('k')]), {
      message:
        'lz-stryker-ui-mutators: another mutator already has the name k.',
    });
  });

  it('does not count its own registered operators as collisions on a second install', async () => {
    const { run, names } = setup();

    await run([operator('Alpha')]);
    await run([operator('Alpha')]);

    assert.deepEqual(names(), [...strykerMutators, 'Alpha']);
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
    assert.deepEqual(names(), strykerMutators);
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

  (
    [
      [
        'a mutant of an operator only from its own sample file',
        { fileName: 'Other.self-check.tsx' },
      ],
      [
        'a mutant in the sample file of an operator only when that operator made it',
        { mutatorName: 'StringLiteral' },
      ],
    ] satisfies [string, Partial<InstrumentedMutant>][]
  ).forEach(([title, fields]) => {
    it(`counts ${title}`, async () => {
      const { run, instrumenter } = setup();
      const changed: Instrumenter = {
        ...instrumenter,
        async instrument(files) {
          const { mutants } = await instrumenter.instrument(files);

          return {
            files,
            mutants: mutants.map((mutant) => ({ ...mutant, ...fields })),
          };
        },
      };

      await assert.rejects(
        run([operator('Alpha')], changed),
        /made no mutants of Alpha from their samples/,
      );
    });
  });

  ['10.1.2', '10.2.0', '110.1.1'].forEach((version) => {
    it(`warns about the instrumenter version ${version} after the self-check passed`, async () => {
      const { run, names, warnings } = setup({ version });

      await run([operator('Alpha')]);

      assert.deepEqual(names(), [...strykerMutators, 'Alpha']);
      assert.deepEqual(warnings, [
        `lz-stryker-ui-mutators was tested with @stryker-mutator/instrumenter ${TESTED_VERSION}, not ${version} in ` +
          '/stryker/instrumenter; its self-check passed.',
      ]);
    });
  });

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

  (
    [
      [
        'another script',
        '/repo/tools/run.ts',
        join('/repo', 'tools', 'run.ts'),
      ],
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
    ] as const
  ).forEach(([title, argv1, real]) => {
    it(`takes the core this module resolves when the process runs ${title}`, () => {
      assert.equal(coreFor(argv1, real), HERE);
    });
  });

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
  const placersFile = (placers: readonly string[]) =>
    `export const allMutantPlacers = [${placers.join(', ')}];`;
  const mutatorsFile = (mutators: readonly string[]) =>
    `export const allMutators = [${mutators.join(', ')}];`;
  const babel = import.meta.resolve('@babel/core');
  const babelFile = (members: string) =>
    `import { types as real } from ${JSON.stringify(babel)};\n` +
    `export const types = { ...real, ${members} };`;
  const instrumenterFile = (result: unknown) =>
    `export class Instrumenter { async instrument() { return ${JSON.stringify(result)}; } }`;
  const placersPath =
    '@stryker-mutator/instrumenter/dist/src/mutant-placers/index.js';
  const indexPath = '@stryker-mutator/instrumenter/dist/src/index.js';
  const mutatorsPath =
    '@stryker-mutator/instrumenter/dist/src/mutators/mutate.js';
  const babelPath = '@babel/core/index.js';

  /** The array a fake module at `path` under `modules` exports as `calls`, from the same module instance. */
  async function callsOf(modules: string, path: string): Promise<unknown> {
    return exported(
      await import(pathToFileURL(join(modules, path)).href),
      'calls',
    );
  }

  /**
   * A core, an instrumenter whose `Instrumenter.instrument` records the logger, files and options it got in its
   * module's `calls`, and a Babel core that re-exports the real types, as node_modules under a fresh directory that
   * `t` removes after the test; `replace` swaps the content of any of those files. Returns core's package.json, the
   * instrumenter's dir and the node_modules dir.
   */
  function fakeCore(
    t: TestContext,
    placers: readonly string[],
    replace: Readonly<Record<string, string>> = {},
  ) {
    const modules = join(tempRoot(t, 'ui-mutators-core-'), 'node_modules');
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

  it('throws, naming the version and dir, when the instrumenter has no expressionMutantPlacer', async (t) => {
    const { corePackage, dir } = fakeCore(t, ['otherPlacer']);

    await assert.rejects(resolveFromCore(corePackage), {
      message: `lz-stryker-ui-mutators: the instrumenter 9.9.8 in ${dir} has no expressionMutantPlacer.`,
    });
  });

  (
    [
      ['allMutators', mutatorsPath, 'export const allMutators = {};'],
      ['allMutators', mutatorsPath, mutatorsFile(['null'])],
      ['allMutators', mutatorsPath, mutatorsFile(['{ mutate() {} }'])],
      [
        'allMutators',
        mutatorsPath,
        mutatorsFile(["{ name: 'A', mutate() {} }", "{ name: 'B' }"]),
      ],
      ['allMutantPlacers', placersPath, 'export const placers = [];'],
      [
        'expressionMutantPlacer',
        placersPath,
        placersFile(["{ name: 'expressionMutantPlacer', place() {} }"]),
      ],
      [
        'expressionMutantPlacer',
        placersPath,
        placersFile(["{ name: 'expressionMutantPlacer', canPlace() {} }"]),
      ],
      ['Instrumenter', indexPath, 'export const Instrumenter = {};'],
      ['Instrumenter', indexPath, 'export class Instrumenter {}'],
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
        message: `lz-stryker-ui-mutators: the instrumenter 9.9.8 in ${dir} has no ${missing}.`,
      });
    });
  });

  it("takes the placer named expressionMutantPlacer, the instrumenter's version and its Babel's types", async (t) => {
    const { corePackage, dir } = fakeCore(t, [
      'otherPlacer',
      'expressionMutantPlacer',
    ]);

    const instrumenter = await resolveFromCore(corePackage);
    const placer: unknown = Reflect.get(
      instrumenter.expressionPlacer.target,
      'name',
    );

    assert.deepEqual(
      {
        dir: instrumenter.dir,
        version: instrumenter.version,
        placer,
      },
      {
        dir,
        version: '9.9.8',
        placer: 'expressionMutantPlacer',
      },
    );
    assert.equal(instrumenter.types, types);
  });

  it('skips placer entries that are not objects', async (t) => {
    const { corePackage } = fakeCore(t, [], {
      [placersPath]: placersFile([
        'null',
        "'expressionMutantPlacer'",
        "{ name: 'expressionMutantPlacer', canPlace() { return false; }, place() {} }",
      ]),
    });

    const instrumenter = await resolveFromCore(corePackage);

    assert.equal(
      Reflect.get(instrumenter.expressionPlacer.target, 'name'),
      'expressionMutantPlacer',
    );
  });

  it("calls the placer's own canPlace and place on the placer, with the arguments it was given", async (t) => {
    const { corePackage, modules } = fakeCore(t, [], {
      [placersPath]:
        'export const calls = [];\n' +
        'const placer = {\n' +
        "  name: 'expressionMutantPlacer',\n" +
        "  canPlace(...args) { calls.push(['canPlace', this === placer, ...args]); return true; },\n" +
        "  place(...args) { calls.push(['place', this === placer, ...args]); },\n" +
        '};\n' +
        'export const allMutantPlacers = [placer];',
    });
    const { original } = (await resolveFromCore(corePackage)).expressionPlacer;
    const path = firstPath(parse('x;'), 'Program');
    const applied = new Map<unknown, types.Node>();

    const placed = original.canPlace(path);
    original.place(path, applied);

    assert.equal(placed, true);
    assert.deepEqual(await callsOf(modules, placersPath), [
      ['canPlace', true, path],
      ['place', true, path, applied],
    ]);
  });

  it('throws, naming the version and dir, when the placer gives canPlace a value that is not a boolean', async (t) => {
    const { corePackage, dir } = fakeCore(t, [], {
      [placersPath]: placersFile([
        "{ name: 'expressionMutantPlacer', canPlace() { return 1; }, place() {} }",
      ]),
    });
    const { original } = (await resolveFromCore(corePackage)).expressionPlacer;
    const path = firstPath(parse('x;'), 'Program');

    assert.throws(() => original.canPlace(path), {
      message: `lz-stryker-ui-mutators: the instrumenter 9.9.8 in ${dir} has an expressionMutantPlacer whose canPlace returned a number, not a boolean.`,
    });
  });

  const mutant = {
    id: '1',
    fileName: 'a.tsx',
    mutatorName: 'StringLiteral',
    replacement: '""',
    location: { start: { line: 1, column: 2 }, end: { line: 1, column: 5 } },
  };
  const withMutant = (fields: Readonly<Record<string, unknown>>) => ({
    files: [],
    mutants: [{ ...mutant, ...fields }],
  });

  it('instruments to new objects of the fields the package reads, with the status or undefined', async (t) => {
    const { corePackage } = fakeCore(t, ['expressionMutantPlacer'], {
      [indexPath]: instrumenterFile({
        files: [{ name: 'a.tsx', content: 'x', mutate: true }],
        mutants: [
          { ...mutant, status: 'Ignored', static: false },
          { ...mutant, id: '2' },
        ],
        extra: true,
      }),
    });
    const instrumenter = await resolveFromCore(corePackage);

    assert.deepEqual(
      await instrumenter.instrument([{ name: 'a.tsx', content: 'x' }]),
      {
        files: [{ name: 'a.tsx', content: 'x' }],
        mutants: [
          { ...mutant, status: 'Ignored' },
          { ...mutant, id: '2', status: undefined },
        ],
      },
    );
  });

  (
    [
      ['files', null],
      ['files', { mutants: [] }],
      ['files[].name', { files: [null], mutants: [] }],
      ['files[].name', { files: [{ name: 1, content: 'x' }], mutants: [] }],
      ['files[].content', { files: [{ name: 'a.tsx' }], mutants: [] }],
      ['mutants', { files: [] }],
      ['mutants[].id', { files: [], mutants: [null] }],
      ['mutants[].id', withMutant({ id: 1 })],
      ['mutants[].fileName', withMutant({ fileName: 1 })],
      ['mutants[].mutatorName', withMutant({ mutatorName: 1 })],
      ['mutants[].replacement', withMutant({ replacement: 1 })],
      ['mutants[].location.start.line', withMutant({ location: null })],
      [
        'mutants[].location.start.line',
        withMutant({ location: { ...mutant.location, start: null } }),
      ],
      [
        'mutants[].location.start.line',
        withMutant({
          location: { ...mutant.location, start: { line: '1', column: 2 } },
        }),
      ],
      [
        'mutants[].location.start.column',
        withMutant({
          location: { ...mutant.location, start: { line: 1, column: '2' } },
        }),
      ],
      [
        'mutants[].location.end.line',
        withMutant({ location: { ...mutant.location, end: null } }),
      ],
      [
        'mutants[].location.end.line',
        withMutant({
          location: { ...mutant.location, end: { line: '1', column: 5 } },
        }),
      ],
      [
        'mutants[].location.end.column',
        withMutant({
          location: { ...mutant.location, end: { line: 1, column: '5' } },
        }),
      ],
      ['mutants[].status', withMutant({ status: 'Done' })],
      ['mutants[].status', withMutant({ status: null })],
    ] as const
  ).forEach(([what, result]) => {
    it(`throws, naming the version and dir, when the instrumenter resolves instrument() to a wrong ${what} (${JSON.stringify(result)})`, async (t) => {
      const { corePackage, dir } = fakeCore(t, ['expressionMutantPlacer'], {
        [indexPath]: instrumenterFile(result),
      });
      const instrumenter = await resolveFromCore(corePackage);

      await assert.rejects(
        instrumenter.instrument([{ name: 'a.tsx', content: 'x' }]),
        {
          message: `lz-stryker-ui-mutators: the instrumenter 9.9.8 in ${dir} resolved Instrumenter.instrument() to a value whose ${what} is missing or of the wrong type.`,
        },
      );
    });
  });

  it('instruments every file with mutate set, no plugins, no ignorers and no exclusions, through a silent logger', async (t) => {
    const { corePackage, modules } = fakeCore(t, ['expressionMutantPlacer']);
    const instrumenter = await resolveFromCore(corePackage);

    await instrumenter.instrument([{ name: 'a.tsx', content: 'x' }]);

    const calls = await callsOf(modules, indexPath);
    assert.ok(Array.isArray(calls) && calls.length === 1);
    const call: unknown = calls[0];
    assert.ok(typeof call === 'object' && call !== null);
    const {
      files,
      options,
      logger,
    }: { files?: unknown; options?: unknown; logger?: unknown } = call;
    assert.ok(typeof logger === 'object' && logger !== null);

    assert.deepEqual(files, [{ name: 'a.tsx', content: 'x', mutate: true }]);
    assert.deepEqual(options, {
      plugins: null,
      excludedMutations: [],
      ignorers: [],
    });
    assert.deepEqual(
      Object.keys(logger).map((name) => {
        const method: unknown = Reflect.get(logger, name);
        const returned: unknown =
          typeof method === 'function'
            ? Reflect.apply(method, undefined, [])
            : method;

        return [name, returned];
      }),
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
