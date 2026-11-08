import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { builtInNames, removeBuiltIns } from '../src/built-ins.ts';
import type { ListedMutator } from '../src/instrumenter.ts';

const packageName = '@layzee/test-mutators';
const listed = (name: string): ListedMutator => ({
  name,
  mutate: () => undefined,
});
const ignoreWarning = (): undefined => undefined;
const fakeInstrumenter = (allMutators: ListedMutator[]) => ({
  dir: '/fake/instrumenter',
  version: '1.2.3',
  allMutators,
});

describe('removeBuiltIns', () => {
  it('removes the 17 built-ins in place and keeps the other entries', () => {
    const own = listed('LzOwn');
    const allMutators = [
      ...builtInNames.slice(0, 5).map(listed),
      own,
      ...builtInNames.slice(5).map(listed),
    ];

    removeBuiltIns(packageName, fakeInstrumenter(allMutators), ignoreWarning);

    assert.deepEqual(allMutators, [own]);
  });

  it('does nothing when none of the built-ins is present, as an earlier call removed them', () => {
    const own = listed('LzOwn');
    const allMutators = [own];

    removeBuiltIns(packageName, fakeInstrumenter(allMutators), ignoreWarning);

    assert.deepEqual(allMutators, [own]);
  });

  it('warns once about each unmarked entry that is not a built-in, and keeps it', () => {
    const unknown = listed('NewStrykerMutator');
    const marked = { ...listed('LzMarked'), [Symbol.for('@layzee/other')]: 1 };
    const allMutators = [...builtInNames.map(listed), unknown, marked];
    const warnings: string[] = [];

    removeBuiltIns(packageName, fakeInstrumenter(allMutators), (message) =>
      warnings.push(message),
    );

    assert.deepEqual(warnings, [
      '@layzee/test-mutators: the mutator NewStrykerMutator is not one of the 17 built-ins this module knows and ' +
        'has no @layzee mark, so it stays on in this run and its reason is unreviewed.',
    ]);
    assert.deepEqual(allMutators, [unknown, marked]);
  });

  it('does not warn when none of the built-ins is present, as nothing is removed', () => {
    const warnings: string[] = [];

    removeBuiltIns(
      packageName,
      fakeInstrumenter([listed('NewStrykerMutator')]),
      (message) => warnings.push(message),
    );

    assert.deepEqual(warnings, []);
  });

  it('throws, naming the missing ones, when only some built-ins are present', () => {
    const allMutators = builtInNames
      .filter((name) => name !== 'Regex' && name !== 'UpdateOperator')
      .map(listed);
    const before = [...allMutators];

    assert.throws(
      () =>
        removeBuiltIns(
          packageName,
          fakeInstrumenter(allMutators),
          ignoreWarning,
        ),
      {
        message:
          '@layzee/test-mutators: the instrumenter 1.2.3 in /fake/instrumenter has no built-in mutators named ' +
          "Regex, UpdateOperator, so this module's list of Stryker's built-ins is out of date.",
      },
    );
    assert.deepEqual(allMutators, before);
  });
});

describe('builtInNames', () => {
  it('lists the 17 built-in mutators of Stryker', () => {
    assert.deepEqual([...builtInNames].sort(), [
      'ArithmeticOperator',
      'ArrayDeclaration',
      'ArrowFunction',
      'AssignmentOperator',
      'BlockStatement',
      'BooleanLiteral',
      'CallExpression',
      'ConditionalExpression',
      'EqualityOperator',
      'LogicalOperator',
      'MethodExpression',
      'ObjectLiteral',
      'OptionalChaining',
      'Regex',
      'StringLiteral',
      'UnaryOperator',
      'UpdateOperator',
    ]);
  });
});
