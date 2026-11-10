import type { StubVerdict } from './reset-setting.ts';

export const spyStubName = 'LzStorybookSpyStub';

export type ReasonVerdict = Exclude<StubVerdict, 'kept'> | 'once-not-rewritten';

const verdicts: readonly ReasonVerdict[] = [
  'erased',
  'order-dependent',
  'unknown',
  'once-not-rewritten',
];

const whys: Readonly<Record<ReasonVerdict, string>> = {
  erased:
    'the mock reset runs before the story renders, so this stub never takes effect',
  'order-dependent':
    'another story in this file resets mocks before it renders, which erases this stub when that story renders first',
  unknown:
    "the file's parameters.test cannot be read without running it, so whether the mock reset erases this stub is unknown",
  'once-not-rewritten':
    'the mock transformer does not rewrite *Once stubs, so the mock reset still erases this stub',
};

const fix =
  'pass the implementation to fn(), as in fn(() => value), or set the stub in beforeEach';

export interface SpyStubReason {
  readonly verdict: ReasonVerdict;
  readonly why: string;
  readonly fix: string;
}

export function parseSpyStubReason(reason: string): SpyStubReason | undefined {
  const verdict = verdicts.find((candidate) =>
    reason.startsWith(`${spyStubName}: ${candidate}: `),
  );

  return verdict === undefined
    ? undefined
    : { verdict, why: whys[verdict], fix };
}

export function spyStubReason(verdict: ReasonVerdict): string {
  return `${spyStubName}: ${verdict}: ${whys[verdict]}; ${fix}`;
}
