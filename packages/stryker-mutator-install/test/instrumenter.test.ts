// corePackageJson with injected realpath and resolve; resolveInstrumenter against a fake core and instrumenter
// written to a temporary node_modules.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, it, type TestContext } from 'node:test';
import { pathToFileURL } from 'node:url';

import { corePackageJson, resolveInstrumenter } from '../src/instrumenter.ts';
import { exported } from './support/exports.ts';
import { tempRoot, writeTree } from './support/temp-tree.ts';

const packageName = '@layzee/test-mutators';

function assertTypes(
  value: unknown,
  missing: (name: string) => Error,
): asserts value is { readonly fake: true } {
  if (Reflect.get(Object(value), 'fake') !== true) {
    throw missing('fake types');
  }
}

function resolveFromCore(corePackage: string) {
  return resolveInstrumenter(packageName, assertTypes, corePackage);
}

describe('corePackageJson', () => {
  const coreDir = join('/global', 'node_modules', '@stryker-mutator', 'core');
  const hereDir = join(
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

        return hereDir;
      },
    );

    assert.deepEqual(realpaths, [argv1]);

    return core;
  }

  it("takes the core whose bin started the process, through the bin's links", () => {
    assert.equal(
      coreFor('/usr/local/bin/stryker', join(coreDir, 'bin', 'stryker.js')),
      join(coreDir, 'package.json'),
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
        join(coreDir, 'bin', 'stryker.js.map'),
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
      assert.equal(coreFor(argv1, real), hereDir);
    });
  });

  // `undefined` passed in takes the default, process.argv[1], so only a process that runs no script has none.
  it('takes the core this module resolves, without a realpath, under node --eval', () => {
    const script =
      `import { corePackageJson } from ${JSON.stringify(pathToFileURL(join(import.meta.dirname, '..', 'src', 'instrumenter.ts')).href)};\n` +
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

describe('resolveFromCore against a fake instrumenter', () => {
  const placersFile = (placers: readonly string[]) =>
    `export const allMutantPlacers = [${placers.join(', ')}];`;
  const mutatorsFile = (mutators: readonly string[]) =>
    `export const allMutators = [${mutators.join(', ')}];`;
  const instrumenterFile = (result: unknown) =>
    `export class Instrumenter { async instrument() { return ${JSON.stringify(result)}; } }`;
  const placersPath =
    '@stryker-mutator/instrumenter/dist/src/mutant-placers/index.js';
  const indexPath = '@stryker-mutator/instrumenter/dist/src/index.js';
  const mutatorsPath =
    '@stryker-mutator/instrumenter/dist/src/mutators/mutate.js';
  const babelPath = '@babel/core/index.js';

  async function callsOf(modules: string, path: string): Promise<unknown> {
    return exported(
      await import(pathToFileURL(join(modules, path)).href),
      'calls',
    );
  }

  function fakeCore(
    t: TestContext,
    placers: readonly string[],
    replace: Readonly<Record<string, string>> = {},
  ) {
    const modules = join(tempRoot(t, 'mutator-install-core-'), 'node_modules');
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
      [babelPath]: 'export const types = { fake: true };',
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
      message: `${packageName}: the instrumenter 9.9.8 in ${dir} has no expressionMutantPlacer.`,
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
      ['fake types', babelPath, 'export const types = {};'],
    ] as const
  ).forEach(([missing, file, content]) => {
    it(`throws, naming the version and dir, when the instrumenter has no ${missing} (${content})`, async (t) => {
      const { corePackage, dir } = fakeCore(t, ['expressionMutantPlacer'], {
        [file]: content,
      });

      await assert.rejects(resolveFromCore(corePackage), {
        message: `${packageName}: the instrumenter 9.9.8 in ${dir} has no ${missing}.`,
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
    assert.deepEqual(instrumenter.types, { fake: true });
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
    const path = { node: 'Program' };
    const applied = new Map<unknown, unknown>();

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
    const path = { node: 'Program' };

    assert.throws(() => original.canPlace(path), {
      message: `${packageName}: the instrumenter 9.9.8 in ${dir} has an expressionMutantPlacer whose canPlace returned a number, not a boolean.`,
    });
  });

  const mutant = { fileName: 'a.tsx', mutatorName: 'StringLiteral' };

  it('instruments to the file and mutator name of each mutant, whatever else the result holds', async (t) => {
    const { corePackage } = fakeCore(t, ['expressionMutantPlacer'], {
      [indexPath]: instrumenterFile({
        mutants: [
          { ...mutant, id: 1, status: 'Done', location: null },
          { fileName: 'b.tsx', mutatorName: 'LzJsxTextLiteral' },
        ],
      }),
    });
    const instrumenter = await resolveFromCore(corePackage);

    assert.deepEqual(
      await instrumenter.instrument([{ name: 'a.tsx', content: 'x' }]),
      [mutant, { fileName: 'b.tsx', mutatorName: 'LzJsxTextLiteral' }],
    );
  });

  (
    [
      null,
      { files: [] },
      { mutants: {} },
      { mutants: [null] },
      { mutants: [{ ...mutant, fileName: 1 }] },
      { mutants: [{ ...mutant, mutatorName: undefined }] },
    ] as const
  ).forEach((result) => {
    it(`throws, naming the version and dir, when the instrumenter resolves instrument() to mutants without names (${JSON.stringify(result)})`, async (t) => {
      const { corePackage, dir } = fakeCore(t, ['expressionMutantPlacer'], {
        [indexPath]: instrumenterFile(result),
      });
      const instrumenter = await resolveFromCore(corePackage);

      await assert.rejects(
        instrumenter.instrument([{ name: 'a.tsx', content: 'x' }]),
        {
          message: `${packageName}: the instrumenter 9.9.8 in ${dir} resolved Instrumenter.instrument() to a value whose mutants are missing or have no string fileName and mutatorName.`,
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
