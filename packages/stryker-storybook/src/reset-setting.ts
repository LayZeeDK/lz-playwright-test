import { combineTags } from 'storybook/internal/csf';

import {
  csfFile,
  defaultExport,
  isTemplateBind,
  namedExports,
  storyArgument,
  storyTags,
  topLevelBindings,
  unwrap,
  withoutBinding,
} from './csf.ts';
import { isRecord, isStringArray } from './is-record.ts';
import { field, list } from './node-field.ts';
import { definitionTimeStubs } from './stub-shape.ts';

export type ResetBranch = 'reset' | 'clear' | 'restore' | 'none' | 'unknown';

export type StubVerdict = 'kept' | 'erased' | 'order-dependent' | 'unknown';

export interface StoryReset {
  readonly name: string;
  readonly branch: ResetBranch;
}

export interface ClassifiedStub {
  readonly start: number;
  readonly end: number;
  readonly line: number;
  readonly once: boolean;
  readonly verdict: StubVerdict;
}

export interface StubClassification {
  readonly stories: readonly StoryReset[];
  readonly stubs: readonly ClassifiedStub[];
}

export type ResetSetting = boolean | 'unreadable';

export type ResetSettings = Readonly<Partial<Record<ResetKey, ResetSetting>>>;

/** In the order Storybook 10.6.5's mock-reset loader checks them. */
const resetKeys = ['mockReset', 'clearMocks', 'restoreMocks'] as const;

type ResetKey = (typeof resetKeys)[number];

export const unreadableSettings: Readonly<Record<ResetKey, ResetSetting>> = {
  mockReset: 'unreadable',
  clearMocks: 'unreadable',
  restoreMocks: 'unreadable',
};

export function readPreviewTest(program: unknown): ResetSettings {
  const body = list(field(program, 'body'));
  const bindings = topLevelBindings(body);
  const exported = defaultExport(body);

  if (exported !== undefined) {
    return testSettings(
      member(evaluate(definePreviewArgument(exported), bindings), 'parameters'),
    );
  }

  const parameters = namedExports(body, bindings).find(
    ({ name }) => name === 'parameters',
  );

  return testSettings(
    parameters === undefined ? undefined : evaluate(parameters.init, bindings),
  );
}

function definePreviewArgument(node: unknown): unknown {
  const current = unwrap(node);

  return field(current, 'type') === 'CallExpression' &&
    field(current, 'callee', 'name') === 'definePreview'
    ? field(current, 'arguments', '0')
    : current;
}

function testSettings(parameters: unknown): ResetSettings {
  const test = member(parameters, 'test');

  // Storybook 10.6.5 combineParameters lets an array replace an object instead of merging into it.
  if (Array.isArray(test)) {
    return unreadableSettings;
  }

  return resetKeys.reduce<Partial<Record<ResetKey, ResetSetting>>>(
    (settings, key) => {
      const value = member(test, key);

      if (value !== undefined) {
        settings[key] = typeof value === 'boolean' ? value : 'unreadable';
      }

      return settings;
    },
    {},
  );
}

/** The tag filter of Storybook's Vitest plugin, and the preview's tags that every story starts from. */
export interface TestTags {
  readonly previewTags: readonly string[];
  readonly include: readonly string[];
  readonly exclude: readonly string[];
  readonly skip: readonly string[];
}

export const defaultTestTags: TestTags = {
  previewTags: [],
  include: ['test'],
  exclude: [],
  skip: [],
};

export interface StoryFile {
  readonly program: unknown;
  readonly code: string;
  readonly fileName: string;
}

export function classifyStubs(
  { program, code, fileName }: StoryFile,
  previewTest: ResetSettings,
  testTags: TestTags,
): StubClassification {
  const body = list(field(program, 'body'));
  const bindings = topLevelBindings(body);
  const tagsByStory = storyTags(code, fileName);
  const {
    metaObjects: [meta],
    stories: exported,
  } = csfFile(body, bindings, ({ name }) => tagsByStory.has(name));
  const metaValue = evaluate(meta, bindings);
  const metaTest = testSettings(member(metaValue, 'parameters'));
  const declared = exported
    .filter(({ name, tested }) => {
      const tags = tagsByStory.get(name);

      return tested && tags !== undefined && isTestedByTags(testTags, tags);
    })
    .flatMap(({ name, init, runtimeAssignments, extendsBase, testOptions }) => {
      const story = runtimeAssignments.reduce(
        (value, assignment) =>
          written(value, assignment.path, evaluate(assignment.value, bindings)),
        extendsBase ? unknownValue : evaluate(storyArgument(init), bindings),
      );
      const isSkipped = storySkipped(
        testTags,
        member(metaValue, 'tags'),
        story,
        testOptions.map((options) =>
          options === undefined ? undefined : evaluate(options, bindings),
        ),
      );

      if (isSkipped === true) {
        return [];
      }

      // Storybook 10.6.5 normalizeStory: { ...story.story?.parameters, ...story.parameters }
      const storyTest = testSettings(
        spread([
          member(member(story, 'story'), 'parameters'),
          member(story, 'parameters'),
        ]),
      );

      return [
        {
          story: {
            name,
            branch:
              isSkipped === 'unknown'
                ? 'unknown'
                : branchOf([previewTest, metaTest, storyTest]),
          },
          init,
        },
      ];
    });
  const stories = declared.map(({ story }) => story);
  const stubs = definitionTimeStubs(program).map(
    ({ start, end, line, once }) => {
      const owner = declared.findIndex(({ init }) => contains(init, start));
      const users = owner === -1 ? stories.map((_, index) => index) : [owner];

      return { start, end, line, once, verdict: siteVerdict(stories, users) };
    },
  );

  return { stories, stubs };
}

/** Storybook 10.6.5 runs each `.test()` call on a factory story as a test of its own, so one of them can run when the story's own test is skipped. */
function storySkipped(
  testTags: TestTags,
  metaTags: unknown,
  story: unknown,
  testOptions: readonly unknown[],
): boolean | 'unknown' {
  const base = skipped(testTags, metaTags, member(story, 'tags'));

  if (base !== true) {
    return base;
  }

  const children = testOptions.map((options) => {
    const child = skipped(
      testTags,
      metaTags,
      childTags(member(story, 'tags'), member(options, 'tags')),
    );

    return child === false && member(options, 'parameters') !== undefined
      ? 'unknown'
      : child;
  });

  return children.includes('unknown')
    ? 'unknown'
    : children.every((child) => child === true);
}

/** Storybook 10.6.5 test-utils.ts `testStory` checks skip tags on the tags prepareStory.ts composes at run time, which hold no play-fn. */
function skipped(
  { previewTags, skip }: TestTags,
  metaTags: unknown,
  storyTags: unknown,
): boolean | 'unknown' {
  if (skip.length === 0) {
    return false;
  }

  const meta = tagList(metaTags);
  const story = tagList(storyTags);

  if (meta === undefined || story === undefined) {
    return 'unknown';
  }

  const tags = combineTags('dev', 'test', ...previewTags, ...meta, ...story);

  return skip.some((tag) => tags.includes(tag));
}

/** Storybook 10.6.5 csf-factories.ts `test` extends the story with these tags, which `extend` combines. */
function childTags(storyTags: unknown, optionTags: unknown): unknown {
  const story = tagList(storyTags);
  const own = tagList(optionTags);

  return story === undefined || own === undefined
    ? unknownValue
    : combineTags(...story, 'test-fn', '!autodocs', ...own);
}

function tagList(value: unknown): readonly string[] | undefined {
  if (value === undefined) {
    return [];
  }

  return isStringArray(value) ? value : undefined;
}

/** Storybook 10.6.5 vitest-plugin transformer.ts `isValidTest`. */
function isTestedByTags(
  { previewTags, include, exclude }: TestTags,
  fileTags: readonly string[],
): boolean {
  const tags = combineTags('test', 'dev', ...previewTags, ...fileTags);

  return (
    (include.length === 0 || include.some((tag) => tags.includes(tag))) &&
    !exclude.some((tag) => tags.includes(tag))
  );
}

function written(
  object: unknown,
  path: readonly unknown[],
  value: unknown,
): unknown {
  const [key, ...rest] = path;

  if (path.length === 0) {
    return value;
  }

  if (typeof key !== 'string') {
    return unknownValue;
  }

  const base = isRecord(object) ? object : {};

  return { ...base, [key]: written(member(base, key), rest, value) };
}

function siteVerdict(
  stories: readonly StoryReset[],
  users: readonly number[],
): StubVerdict {
  const erasesBy = (index: number): boolean =>
    stories.slice(0, index + 1).some(({ branch }) => erases(branch));

  if (!erasesBy(stories.length - 1)) {
    return stories.some(({ branch }) => branch === 'unknown')
      ? 'unknown'
      : 'kept';
  }

  return users.every(erasesBy) ? 'erased' : 'order-dependent';
}

function erases(branch: ResetBranch): boolean {
  return branch === 'reset' || branch === 'restore';
}

function contains(node: unknown, position: number): boolean {
  const start = field(node, 'start');
  const end = field(node, 'end');

  return (
    typeof start === 'number' &&
    typeof end === 'number' &&
    start <= position &&
    position < end
  );
}

const decisiveSettings: Readonly<
  Record<ResetKey, readonly [boolean, ResetBranch]>
> = {
  mockReset: [true, 'reset'],
  clearMocks: [true, 'clear'],
  restoreMocks: [false, 'none'],
};

function branchOf(levels: readonly ResetSettings[]): ResetBranch {
  return (
    resetKeys
      .map((key) => {
        const [decisive, branch] = decisiveSettings[key];
        const setting = levels.reduce<ResetSetting | undefined>(
          (value, level) => level[key] ?? value,
          undefined,
        );

        if (setting === 'unreadable') {
          return 'unknown';
        }

        return setting === decisive ? branch : undefined;
      })
      .find((branch) => branch !== undefined) ?? 'restore'
  );
}

function evaluate(
  node: unknown,
  bindings: ReadonlyMap<string, unknown>,
): unknown {
  const current = unwrap(node);

  switch (field(current, 'type')) {
    case 'BooleanLiteral': {
      return field(current, 'value');
    }
    case 'FunctionDeclaration':
    case 'FunctionExpression':
    case 'ArrowFunctionExpression': {
      return undefined;
    }
    case 'CallExpression': {
      return isTemplateBind(current) ? undefined : unknownValue;
    }
    case 'Identifier': {
      const name = field(current, 'name');

      if (name === 'undefined') {
        return undefined;
      }

      return typeof name === 'string' && bindings.has(name)
        ? evaluate(bindings.get(name), withoutBinding(bindings, name))
        : unknownValue;
    }
    case 'ArrayExpression': {
      return list(field(current, 'elements')).map((element) =>
        field(element, 'type') === 'StringLiteral'
          ? field(element, 'value')
          : unknownValue,
      );
    }
    case 'ObjectExpression': {
      return spread(
        list(field(current, 'properties')).map((property) =>
          objectPart(property, bindings),
        ),
      );
    }
    default: {
      return unknownValue;
    }
  }
}

function spread(parts: readonly unknown[]): unknown {
  return parts.reduce<Readonly<Record<PropertyKey, unknown>>>(
    (object, part) => {
      if (!isRecord(part)) {
        return object;
      }

      return Object.hasOwn(part, unknownRest) ? part : { ...object, ...part };
    },
    {},
  );
}

function objectPart(
  property: unknown,
  bindings: ReadonlyMap<string, unknown>,
): unknown {
  if (field(property, 'type') === 'SpreadElement') {
    return evaluate(field(property, 'argument'), bindings);
  }

  if (field(property, 'computed') === true) {
    return unknownValue;
  }

  return {
    [String(field(property, 'key', 'name') ?? field(property, 'key', 'value'))]:
      evaluate(field(property, 'value'), bindings),
  };
}

const unknownRest = Symbol('unknown rest');

const unknownValue: Readonly<Record<symbol, true>> = { [unknownRest]: true };

function member(value: unknown, key: string): unknown {
  if (
    isRecord(value) &&
    !Object.hasOwn(value, key) &&
    Object.hasOwn(value, unknownRest)
  ) {
    return unknownValue;
  }

  return field(value, key);
}
