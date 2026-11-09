import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { bindingOf, callTypes, memberTypes } from '../src/ast.ts';

describe('bindingOf', () => {
  it('returns what the scope binds the name to', () => {
    const binding = { kind: 'module' };
    const scope = {
      getBinding(this: unknown, name: unknown) {
        return this === scope && name === 'track' ? binding : undefined;
      },
    };

    assert.equal(bindingOf({ scope }, 'track'), binding);
  });

  it('returns undefined for a path without a scope', () => {
    assert.equal(bindingOf({}, 'track'), undefined);
  });
});

describe('the Babel node type lists', () => {
  it('names the plain and optional call', () => {
    assert.deepEqual(callTypes, ['CallExpression', 'OptionalCallExpression']);
  });

  it('names the plain and optional member access', () => {
    assert.deepEqual(memberTypes, [
      'MemberExpression',
      'OptionalMemberExpression',
    ]);
  });
});
