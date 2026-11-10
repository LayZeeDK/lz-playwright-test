import {
  type Assignment,
  csfFile,
  defaultExport,
  definePreviewArgument,
  isTemplateBind,
  namedExports,
  storyArgument,
  topLevelBindings,
  unwrap,
  withoutBinding,
} from './csf.ts';
import { isRecord } from './is-record.ts';
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

type ResetKey = (typeof decisiveSettings)[number][0];

export const unreadableSettings: ResetSettings = {
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

function testSettings(parameters: unknown): ResetSettings {
  const test = member(parameters, 'test');

  return Object.fromEntries(
    decisiveSettings.flatMap(([key]) => {
      const value = member(test, key);

      if (value === undefined) {
        return [];
      }

      return [[key, typeof value === 'boolean' ? value : 'unreadable']];
    }),
  );
}

export function classifyStubs(
  program: unknown,
  previewTest: ResetSettings,
): StubClassification {
  const body = list(field(program, 'body'));
  const bindings = topLevelBindings(body);
  const {
    metaObjects: [meta],
    isFactory,
    stories: exported,
  } = csfFile(body, bindings);
  const metaTest = testSettings(member(evaluate(meta, bindings), 'parameters'));
  const declared = exported
    .filter(({ tested }) => tested)
    .map(({ name, init, assignments }) => {
      const story = runtimeAssignments(assignments, isFactory).reduce(
        (value, assignment) =>
          written(value, assignment.path, evaluate(assignment.value, bindings)),
        evaluate(storyArgument(init), bindings),
      );
      // Storybook 10.6.5 normalizeStory: { ...story.story?.parameters, ...story.parameters }
      const storyTest = testSettings(
        spread([
          member(member(story, 'story'), 'parameters'),
          member(story, 'parameters'),
        ]),
      );

      return {
        story: { name, branch: branchOf([previewTest, metaTest, storyTest]) },
        init,
      };
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

/** Storybook 10.6.5 composes a factory story from the keys of the `input` that `defineStory` closed over, so only writes below `input` count. */
function runtimeAssignments(
  assignments: readonly Assignment[],
  isFactory: boolean,
): readonly Assignment[] {
  if (!isFactory) {
    return assignments;
  }

  return assignments.flatMap((assignment) =>
    assignment.path[0] === 'input' && assignment.path.length > 1
      ? [{ ...assignment, path: assignment.path.slice(1) }]
      : [],
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

const decisiveSettings = [
  ['mockReset', true, 'reset'],
  ['clearMocks', true, 'clear'],
  ['restoreMocks', false, 'none'],
] as const;

function branchOf(levels: readonly ResetSettings[]): ResetBranch {
  return (
    decisiveSettings
      .map(([key, decisive, branch]) => {
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
