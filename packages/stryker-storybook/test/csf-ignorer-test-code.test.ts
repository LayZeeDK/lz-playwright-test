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
