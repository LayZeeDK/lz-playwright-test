import type { Case } from './cases.ts';

const mountStory = 'LzPlaywrightMountStory';

function inTest(statements: readonly string[]): string {
  return `test('case', async ({ mount }) => {\n  ${statements.join('\n  ')}\n});`;
}

function mounts(...args: readonly string[]): string {
  return inTest(args.map((arg) => `await mount(${arg});`));
}

export const mountStoryCases: readonly Case[] = [
  {
    id: 'mount-two-ids',
    title: 'two mounted ids each take the other',
    source: mounts("'a'", "'b'"),
    expect: [
      [mountStory, "'b'"],
      [mountStory, "'a'"],
    ],
  },
  {
    id: 'mount-regex',
    title: 'a regex is neither site nor replacement',
    source: mounts("'a'", '/b/', "'c'"),
    expect: [
      [mountStory, "'c'"],
      [mountStory, "'a'"],
    ],
  },
  {
    id: 'mount-template',
    title: 'an expression-free template and a string replace each other',
    source: mounts('`a`', "'b'"),
    expect: [
      [mountStory, "'b'"],
      [mountStory, '`a`'],
    ],
  },
  {
    id: 'mount-template-expression',
    title: 'a template with an expression is neither site nor replacement',
    source: mounts("'a'", '`a/${story}`', "'b'"),
    expect: [
      [mountStory, "'b'"],
      [mountStory, "'a'"],
    ],
  },
  {
    id: 'mount-not-literal',
    title:
      'an identifier or an object argument is neither site nor replacement',
    source: mounts("'a'", 'story', "{ id: 'c' }", "'b'"),
    expect: [
      [mountStory, "'b'"],
      [mountStory, "'a'"],
    ],
  },
  {
    id: 'mount-not-mount',
    title:
      'another method, a computed mount and a second argument are no sites',
    source: inTest([
      "await mount('a');",
      "await gallery.mounted('b');",
      "await gallery['mount']('c');",
      "await mount(Story, 'd');",
    ]),
    expect: [],
  },
  {
    id: 'mount-lone',
    title: 'a lone mounted id makes no mutant',
    source: mounts("'a'"),
    expect: [],
  },
  {
    id: 'mount-nearest-two',
    title: 'the nearest id before and the nearest after are used, no more',
    source: mounts("'a'", "'b'", "'c'", "'d'"),
    expect: [
      [mountStory, "'b'"],
      [mountStory, "'a'"],
      [mountStory, "'c'"],
      [mountStory, "'b'"],
      [mountStory, "'d'"],
      [mountStory, "'c'"],
    ],
  },
  {
    id: 'mount-equal-neighbours',
    title: 'an id with the same neighbour on both sides gets one mutant',
    source: mounts("'a'", "'b'", "'a'"),
    expect: [
      [mountStory, "'b'"],
      [mountStory, "'a'"],
      [mountStory, "'b'"],
    ],
  },
  {
    id: 'mount-equal-skipped',
    title: 'an equal id is skipped for the next distinct one',
    source: mounts("'a'", "'a'", "'b'"),
    expect: [
      [mountStory, "'b'"],
      [mountStory, "'b'"],
      [mountStory, "'a'"],
    ],
  },
  ...(
    [
      ['suffix-first', "'Button/Primary'", "'components/Button/Primary'"],
      ['suffix-second', "'components/Button/Primary'", "'Button/Primary'"],
    ] as const
  ).map(
    ([order, one, other]): Case => ({
      id: `mount-path-${order}`,
      title: `${one} and ${other} name the same story and never replace each other`,
      source: mounts(one, other),
      expect: [],
    }),
  ),
  {
    id: 'mount-path-suffix-skipped',
    title: 'an id naming the same story is skipped for the next distinct one',
    source: mounts("'stories/Button'", "'Button'", "'Card'"),
    expect: [
      [mountStory, "'Card'"],
      [mountStory, "'Card'"],
      [mountStory, "'Button'"],
    ],
  },
  ...(
    [
      ['no-slash', "'Primary'", "'XPrimary'"],
      ['inner-slash', "'Primary'", "'Button/APrimary'"],
    ] as const
  ).map(
    ([kind, one, other]): Case => ({
      id: `mount-text-suffix-${kind}`,
      title: `${one} and ${other} are different stories and replace each other`,
      source: mounts(one, other),
      expect: [
        [mountStory, other],
        [mountStory, one],
      ],
    }),
  ),
  ...['gallery.mount', 'fixtures.gallery.mount', 'gallery?.mount'].map(
    (callee): Case => ({
      id: `mount-receiver-${callee.replaceAll(/\W/g, '-')}`,
      title: `${callee} is a mount on any receiver`,
      source: inTest([`await ${callee}('a');`, `await ${callee}('b');`]),
      expect: [
        [mountStory, "'b'"],
        [mountStory, "'a'"],
      ],
    }),
  ),
];
