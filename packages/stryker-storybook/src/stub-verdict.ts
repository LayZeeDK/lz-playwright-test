import {
  classifyStubs,
  type ClassifiedStub,
  type StubVerdict,
} from './reset-setting.ts';
import type { StorybookProject } from './storybook-project.ts';

export const spyStubName = 'LzStorybookSpyStub';

export type ReasonVerdict = Exclude<StubVerdict, 'kept'> | 'once-not-rewritten';

export interface ReasonSite extends Omit<ClassifiedStub, 'verdict' | 'once'> {
  readonly verdict: ReasonVerdict;
}

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

export const uncheckedFinding = {
  verdict: 'unchecked',
  why: 'no test fails without this stub, so no play checks what it changes',
  fix: 'assert in the play what the stubbed value changes',
} as const;

export interface SpyStubReason {
  readonly verdict: ReasonVerdict;
  readonly why: string;
  readonly fix: string;
}

export function reasonSites(
  program: unknown,
  { previewTest, testTags, transformer }: StorybookProject,
): readonly ReasonSite[] {
  return classifyStubs(program, previewTest, testTags).stubs.flatMap(
    ({ once, verdict, ...site }): readonly ReasonSite[] => {
      if (verdict === 'kept') {
        return [];
      }

      if (transformer === 'seen') {
        return once ? [{ ...site, verdict: 'once-not-rewritten' }] : [];
      }

      return [{ ...site, verdict }];
    },
  );
}

export function describeVerdict(verdict: ReasonVerdict): SpyStubReason {
  return { verdict, why: whys[verdict], fix };
}

export function spyStubReason(verdict: ReasonVerdict): string {
  return `${spyStubName}: ${verdict}: ${whys[verdict]}; ${fix}`;
}
