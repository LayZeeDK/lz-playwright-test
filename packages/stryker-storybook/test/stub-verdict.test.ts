import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { spyStubReason } from '../src/stub-verdict.ts';

const fix =
  'pass the implementation to fn(), as in fn(() => value), or set the stub in beforeEach';

describe('spyStubReason', () => {
  it('names the ignorer, the erased verdict, why and the fix', () => {
    assert.equal(
      spyStubReason('erased'),
      `lz-storybook: erased: the mock reset runs before the story renders, so this stub never takes effect; ${fix}`,
    );
  });

  it('says why an order-dependent stub is erased only in some orders', () => {
    assert.equal(
      spyStubReason('order-dependent'),
      `lz-storybook: order-dependent: another story in this file resets mocks before it renders, which erases this stub when that story renders first; ${fix}`,
    );
  });

  it('says why an unknown verdict could not be read', () => {
    assert.equal(
      spyStubReason('unknown'),
      `lz-storybook: unknown: the file's parameters.test cannot be read without running it, so whether the mock reset erases this stub is unknown; ${fix}`,
    );
  });

  it('says why a *Once stub stays erased with the mock transformer on', () => {
    assert.equal(
      spyStubReason('once-not-rewritten'),
      `lz-storybook: once-not-rewritten: the mock transformer does not rewrite *Once stubs, so the mock reset still erases this stub; ${fix}`,
    );
  });
});
