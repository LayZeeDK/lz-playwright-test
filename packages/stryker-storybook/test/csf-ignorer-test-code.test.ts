import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  metaReason,
  mswReason,
  setup,
  testReason,
} from './support/csf-ignorer.ts';

describe('lz-storybook-csf', () => {
  it("ignores a story's play function", async () => {
    const { outcomes } = setup();

    assert.deepEqual(
      (
        await outcomes(
          "export default { title: 'a/b' };\nexport const A = {\n  play: async () => {\n    await x(1 + 1);\n  },\n};",
        )
      ).filter((outcome) => /^[34] /.test(outcome)),
      [`3 BlockStatement ${testReason}`, `4 ArithmeticOperator ${testReason}`],
    );
  });

  it('ignores the play function that a story names', async () => {
    const { outcomes } = setup();

    assert.deepEqual(
      (
        await outcomes(
          "export default { title: 'a/b' };\nconst sharedPlay = async () => {\n  await x(1 + 1);\n};\nexport const A = {\n  play: sharedPlay,\n};",
        )
      ).filter((outcome) => /^[23] /.test(outcome)),
      [`2 BlockStatement ${testReason}`, `3 ArithmeticOperator ${testReason}`],
    );
  });

  it('ignores the play function declaration that a story names', async () => {
    const { outcomes } = setup();

    assert.deepEqual(
      (
        await outcomes(
          "export default { title: 'a/b' };\nasync function sharedPlay() {\n  await x(1 + 1);\n}\nexport const A = {\n  play: sharedPlay,\n};",
        )
      ).filter((outcome) => /^[23] /.test(outcome)),
      [`2 BlockStatement ${testReason}`, `3 ArithmeticOperator ${testReason}`],
    );
  });

  it("ignores a story's play method", async () => {
    const { outcomes } = setup();

    assert.deepEqual(
      (
        await outcomes(
          "export default { title: 'a/b' };\nexport const A = {\n  async play() {\n    await x(1 + 1);\n  },\n};",
        )
      ).filter((outcome) => /^[34] /.test(outcome)),
      [`3 BlockStatement ${testReason}`, `4 ArithmeticOperator ${testReason}`],
    );
  });

  it('ignores a play function assigned to X.play', async () => {
    const { outcomes } = setup();

    assert.deepEqual(
      (
        await outcomes(
          "export default { title: 'a/b' };\nexport const A = {};\nA.play = async () => {\n  await x(1 + 1);\n};",
        )
      ).filter((outcome) => /^[34] /.test(outcome)),
      [`3 BlockStatement ${testReason}`, `4 ArithmeticOperator ${testReason}`],
    );
  });

  it('ignores the play function that X.play names', async () => {
    const { outcomes } = setup();

    assert.deepEqual(
      (
        await outcomes(
          "export default { title: 'a/b' };\nconst sharedPlay = async () => {\n  await x(1 + 1);\n};\nexport const A = {};\nA.play = sharedPlay;",
        )
      ).filter((outcome) => /^[23] /.test(outcome)),
      [`2 BlockStatement ${testReason}`, `3 ArithmeticOperator ${testReason}`],
    );
  });

  it('ignores a play function assigned to the local binding of a renamed story', async () => {
    const { outcomes } = setup();

    assert.deepEqual(
      (
        await outcomes(
          "export default { title: 'a/b' };\nconst Local = {};\nLocal.play = async () => {\n  await x(1 + 1);\n};\nexport { Local as A };",
        )
      ).filter((outcome) => /^[34] /.test(outcome)),
      [`3 BlockStatement ${testReason}`, `4 ArithmeticOperator ${testReason}`],
    );
  });

  it('ignores the play function of a story in a file that exports a schema made by .extend()', async () => {
    const { outcomes } = setup();

    assert.deepEqual(
      (
        await outcomes(
          "export default { title: 'a/b', excludeStories: /Schema$/ };\nexport const A = {\n  play: async () => {\n    await x(1 + 1);\n  },\n};\nexport const userSchema = z.object({}).extend({ name: z.string() });",
        )
      ).filter((outcome) => /^[34] /.test(outcome)),
      [`3 BlockStatement ${testReason}`, `4 ArithmeticOperator ${testReason}`],
    );
  });

  it('places a play function assigned to an export that excludeStories matches', async () => {
    const { outcomes } = setup();

    assert.deepEqual(
      (
        await outcomes(
          "export default { title: 'a/b', excludeStories: ['Hidden'] };\nexport const Hidden = {};\nHidden.play = async () => {\n  await x(1 + 1);\n};",
        )
      ).filter((outcome) => /^[34] /.test(outcome)),
      ['3 BlockStatement placed', '4 ArithmeticOperator placed'],
    );
  });

  it("ignores the meta's play function", async () => {
    const { outcomes } = setup();

    assert.deepEqual(
      (
        await outcomes(
          'export default {\n  play: async () => {\n    await x(1 + 1);\n  },\n};',
        )
      ).filter((outcome) => /^[23] /.test(outcome)),
      [`2 BlockStatement ${metaReason}`, `3 ArithmeticOperator ${metaReason}`],
    );
  });

  it('ignores the play function that the meta names', async () => {
    const { outcomes } = setup();

    assert.deepEqual(
      (
        await outcomes(
          'const sharedPlay = async () => {\n  await x(1 + 1);\n};\nexport default {\n  play: sharedPlay,\n};',
        )
      ).filter((outcome) => /^[12] /.test(outcome)),
      [`1 BlockStatement ${testReason}`, `2 ArithmeticOperator ${testReason}`],
    );
  });

  it("places a story's play function in 'mutate' mode", async () => {
    const { outcomes } = setup('mutate');

    assert.deepEqual(
      (
        await outcomes(
          "export default { title: 'a/b' };\nexport const A = {\n  play: async () => {\n    await x(1 + 1);\n  },\n};",
        )
      ).filter((outcome) => /^[34] /.test(outcome)),
      ['3 BlockStatement placed', '4 ArithmeticOperator placed'],
    );
  });

  it("places the meta's play function in 'mutate' mode", async () => {
    const { outcomes } = setup('mutate');

    assert.deepEqual(
      (
        await outcomes(
          'export default {\n  play: async () => {\n    await x(1 + 1);\n  },\n};',
        )
      ).filter((outcome) => /^[23] /.test(outcome)),
      ['2 BlockStatement placed', '3 ArithmeticOperator placed'],
    );
  });

  it('ignores the body of a .test() call', async () => {
    const { outcomes } = setup();

    assert.deepEqual(
      (
        await outcomes(
          "export default { title: 'a/b' };\nexport const A = {};\nA.test('name', async () => {\n  await x(1 + 1);\n});",
        )
      ).filter((outcome) =>
        /^[34] (BlockStatement|ArithmeticOperator)/.test(outcome),
      ),
      [`3 BlockStatement ${testReason}`, `4 ArithmeticOperator ${testReason}`],
    );
  });

  it('ignores the body that a .test() call names', async () => {
    const { outcomes } = setup();

    assert.deepEqual(
      (
        await outcomes(
          "export default { title: 'a/b' };\nexport const A = {};\nconst body = async () => {\n  await x(1 + 1);\n};\nA.test('name', body);",
        )
      ).filter((outcome) => /^[34] /.test(outcome)),
      [`3 BlockStatement ${testReason}`, `4 ArithmeticOperator ${testReason}`],
    );
  });

  it('ignores the function declaration that a .test() call names', async () => {
    const { outcomes } = setup();

    assert.deepEqual(
      (
        await outcomes(
          "export default { title: 'a/b' };\nexport const A = {};\nasync function body() {\n  await x(1 + 1);\n}\nA.test('name', body);",
        )
      ).filter((outcome) => /^[34] /.test(outcome)),
      [`3 BlockStatement ${testReason}`, `4 ArithmeticOperator ${testReason}`],
    );
  });

  it('ignores the statement of a .test() call', async () => {
    const { outcomes } = setup();

    assert.deepEqual(
      (
        await outcomes(
          "export default { title: 'a/b' };\nexport const A = {};\nA.test('name', async () => {\n  await x(1 + 1);\n});",
        )
      ).filter((outcome) => outcome.startsWith('3 CallExpression')),
      [`3 CallExpression ${testReason}`],
    );
  });

  it('places a .test() call on an object that is not a story', async () => {
    const { outcomes } = setup();

    assert.deepEqual(
      (
        await outcomes(
          "export default { title: 'a/b' };\n/a/.test(1 + 1 === 2 ? 'a' : 'b');",
        )
      ).filter((outcome) => outcome.startsWith('2 ArithmeticOperator')),
      ['2 ArithmeticOperator placed'],
    );
  });

  it('places the body of a call to another method of a story', async () => {
    const { outcomes } = setup();

    assert.deepEqual(
      (
        await outcomes(
          "export default { title: 'a/b' };\nexport const A = {};\nA.other('name', async () => {\n  await x(1 + 1);\n});",
        )
      ).filter((outcome) =>
        /^[34] (BlockStatement|ArithmeticOperator)/.test(outcome),
      ),
      ['3 BlockStatement placed', '4 ArithmeticOperator placed'],
    );
  });

  it("ignores a story's beforeEach", async () => {
    const { outcomes } = setup();

    assert.deepEqual(
      (
        await outcomes(
          "export default { title: 'a/b' };\nexport const A = {\n  beforeEach: async () => {\n    await x(1 + 1);\n  },\n};",
        )
      ).filter((outcome) => /^[34] /.test(outcome)),
      [`3 BlockStatement ${testReason}`, `4 ArithmeticOperator ${testReason}`],
    );
  });

  it("ignores a story's afterEach", async () => {
    const { outcomes } = setup();

    assert.deepEqual(
      (
        await outcomes(
          "export default { title: 'a/b' };\nexport const A = {\n  afterEach: async () => {\n    await x(1 + 1);\n  },\n};",
        )
      ).filter((outcome) => /^[34] /.test(outcome)),
      [`3 BlockStatement ${testReason}`, `4 ArithmeticOperator ${testReason}`],
    );
  });

  it('ignores a function assigned to X.beforeEach', async () => {
    const { outcomes } = setup();

    assert.deepEqual(
      (
        await outcomes(
          "export default { title: 'a/b' };\nexport const A = {};\nA.beforeEach = async () => {\n  await x(1 + 1);\n};",
        )
      ).filter((outcome) => /^[34] /.test(outcome)),
      [`3 BlockStatement ${testReason}`, `4 ArithmeticOperator ${testReason}`],
    );
  });

  it("ignores the msw value in a story's parameters", async () => {
    const { outcomes } = setup();

    assert.deepEqual(
      (
        await outcomes(
          "export default { title: 'a/b' };\nexport const A = {\n  parameters: {\n    msw: {\n      handlers: [h('/a')],\n    },\n  },\n};",
        )
      ).filter((outcome) => /^[3-5] /.test(outcome)),
      [
        '3 ObjectLiteral placed',
        `4 ObjectLiteral ${mswReason}`,
        `5 ArrayDeclaration ${mswReason}`,
        `5 StringLiteral ${mswReason}`,
      ],
    );
  });

  it('ignores the msw value in an object assigned to X.parameters', async () => {
    const { outcomes } = setup();

    assert.deepEqual(
      (
        await outcomes(
          "export default { title: 'a/b' };\nexport const A = {};\nA.parameters = {\n  msw: {\n    handlers: [h('/a')],\n  },\n};",
        )
      ).filter((outcome) => /^[3-5] /.test(outcome)),
      [
        '3 ObjectLiteral placed',
        `4 ObjectLiteral ${mswReason}`,
        `5 ArrayDeclaration ${mswReason}`,
        `5 StringLiteral ${mswReason}`,
      ],
    );
  });

  it('ignores the msw value in the parameters that a story names', async () => {
    const { outcomes } = setup();

    assert.deepEqual(
      (
        await outcomes(
          "export default { title: 'a/b' };\nconst params = {\n  msw: {\n    handlers: [h('/a')],\n  },\n};\nexport const A = { parameters: params };",
        )
      ).filter((outcome) => /^[2-4] /.test(outcome)),
      [
        '2 ObjectLiteral placed',
        `3 ObjectLiteral ${mswReason}`,
        `4 ArrayDeclaration ${mswReason}`,
        `4 StringLiteral ${mswReason}`,
      ],
    );
  });

  it('ignores the msw value that a story names', async () => {
    const { outcomes } = setup();

    assert.deepEqual(
      (
        await outcomes(
          "export default { title: 'a/b' };\nconst msw = {\n  handlers: [h('/a')],\n};\nexport const A = { parameters: { msw } };",
        )
      ).filter((outcome) => /^[23] /.test(outcome)),
      [
        `2 ObjectLiteral ${mswReason}`,
        `3 ArrayDeclaration ${mswReason}`,
        `3 StringLiteral ${mswReason}`,
      ],
    );
  });

  it('ignores the msw value in the parameters that the meta names', async () => {
    const { outcomes } = setup();

    assert.deepEqual(
      (
        await outcomes(
          "const params = {\n  msw: {\n    handlers: [h('/a')],\n  },\n};\nexport default { title: 'a/b', parameters: params };",
        )
      ).filter((outcome) => /^[1-3] /.test(outcome)),
      [
        '1 ObjectLiteral placed',
        `2 ObjectLiteral ${mswReason}`,
        `3 ArrayDeclaration ${mswReason}`,
        `3 StringLiteral ${mswReason}`,
      ],
    );
  });

  it('places the value that a statement reads from X.play without assigning it', async () => {
    const { outcomes } = setup();

    assert.deepEqual(
      (
        await outcomes(
          "export default { title: 'a/b' };\nexport const A = {};\nconst x = 1 + 1;\nA.play || x;",
        )
      ).filter((outcome) => outcome.startsWith('3 ')),
      ['3 ArithmeticOperator placed'],
    );
  });

  it('places a value given to X.play by a compound assignment', async () => {
    const { outcomes } = setup();

    assert.deepEqual(
      (
        await outcomes(
          "export default { title: 'a/b' };\nexport const A = {};\nA.play ??= 1 + 1;",
        )
      ).filter((outcome) => outcome.startsWith('3 ')),
      ['3 AssignmentOperator placed', '3 ArithmeticOperator placed'],
    );
  });

  it('places a play function assigned to this.play after this.story', async () => {
    const { outcomes } = setup();

    assert.deepEqual(
      (
        await outcomes(
          "export default { title: 'a/b' };\nthis.story = {};\nthis.play = 1 + 1;",
        )
      ).filter((outcome) => outcome.startsWith('3 ')),
      ['3 ArithmeticOperator placed'],
    );
  });

  it('places the msw value in parameters assigned to an object that is not a story', async () => {
    const { outcomes } = setup();

    assert.deepEqual(
      (
        await outcomes(
          "export default { title: 'a/b' };\nconst helper = {};\nhelper.parameters = {\n  msw: { handlers: [] },\n};",
        )
      ).filter((outcome) => outcome.startsWith('4 ')),
      ['4 ObjectLiteral placed', '4 ArrayDeclaration placed'],
    );
  });

  it('ignores the msw value in the parameters passed to meta.story()', async () => {
    const { outcomes } = setup();

    assert.deepEqual(
      (
        await outcomes(
          "const meta = preview.meta({ component: B });\nexport const A = meta.story({\n  parameters: {\n    msw: {\n      handlers: [h('/a')],\n    },\n  },\n});",
        )
      ).filter((outcome) => /^[4-5] /.test(outcome)),
      [
        `4 ObjectLiteral ${mswReason}`,
        `5 ArrayDeclaration ${mswReason}`,
        `5 StringLiteral ${mswReason}`,
      ],
    );
  });
});
