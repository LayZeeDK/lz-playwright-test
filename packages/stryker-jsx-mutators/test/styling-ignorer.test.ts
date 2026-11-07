// The lz-jsx-styling ignorer, through StrykerJS's own instrumenter with only its built-in mutators.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { resolveFromCore } from '../src/install.ts';
import {
  strykerValidationSchema,
  stylingIgnorer,
} from '../src/styling-ignorer.ts';
import { instrumentFully } from './support/instrument-result.ts';
import { validateOptions } from './support/validate-options.ts';

const classReason =
  'lz-jsx-styling: class names only style the element; DOM tests do not observe them';
const styleReason =
  'lz-jsx-styling: inline styles only style the element; DOM tests do not observe them';
const builderReason =
  'lz-jsx-styling: class-name builder call; DOM tests do not observe class names';

const instrumenter = resolveFromCore();

/** One entry per mutant: its ignore reason, or `placed`. */
async function outcomes(code: string, options: object = {}): Promise<string[]> {
  const { mutants } = await instrumentFully(
    await instrumenter,
    [{ name: 'a.tsx', content: code }],
    [],
    [stylingIgnorer(options)],
  );

  return mutants.map(({ status, statusReason }) =>
    status === 'Ignored' ? (statusReason ?? 'Ignored') : 'placed',
  );
}

async function assertEvery(
  code: string,
  outcome: string,
  options: object = {},
): Promise<void> {
  const found = await outcomes(code, options);

  assert.ok(found.length > 0, `no mutants in ${code}`);
  assert.deepEqual(new Set(found), new Set([outcome]), code);
}

describe('lz-jsx-styling', () => {
  it('ignores every mutant in a className expression, with the class reason', async () => {
    await assertEvery(
      "export const a = <a className={cn('a', on && 'b')} />;",
      classReason,
    );
  });

  ['class', 'containerClassName'].forEach((name) => {
    it(`ignores every mutant in a ${name} expression`, async () => {
      await assertEvery(
        `export const a = <a ${name}={on ? 'a' : 'b'} />;`,
        classReason,
      );
    });
  });

  it('ignores a NavLink className callback, the arrow and the classes it picks', async () => {
    await assertEvery(
      "export const a = <NavLink className={({ isActive }) => cn('p-2', isActive && 'bg-accent')} />;",
      classReason,
    );
  });

  it('keeps the mutants of a handler beside the className', async () => {
    assert.deepEqual(
      await outcomes(
        "export const a = <a className={on ? 'a' : 'b'} onClick={() => go(true)} />;",
      ),
      [classReason, classReason, 'placed', 'placed'],
    );
  });

  [
    'hidden',
    'invisible',
    'collapse',
    'sr-only',
    'not-sr-only',
    'd-none',
    'visually-hidden',
    'is-hidden',
    'md:hidden',
    'peer-invalid:hidden',
  ].forEach((token) => {
    it(`keeps the mutants of a className that can add the visibility class ${token}`, async () => {
      await assertEvery(
        `export const a = <a className={on ? 'p-2 block' : 'p-2 ${token}'} />;`,
        'placed',
      );
    });
  });

  it('finds a visibility class in a template literal', async () => {
    await assertEvery(
      "export const a = <a className={`p-2 ${on ? 'x' : 'y'} hidden`} />;",
      'placed',
    );
  });

  it('finds a visibility class in an object key of a class builder', async () => {
    await assertEvery(
      "export const a = <a className={cn('p-2', { hidden: !open, 'sr-only': on })} />;",
      'placed',
    );
  });

  ['{ hidden: !open }', '{ hidden() { return open; } }'].forEach((value) => {
    it(`finds a visibility class in the identifier key of ${value} when no string holds it`, async () => {
      await assertEvery(
        `export const a = <a className={cn('p-2', ${value})} />;`,
        'placed',
      );
    });
  });

  it('ignores a class builder whose only visibility word is a computed key', async () => {
    await assertEvery(
      "export const a = <a className={cn('p-2', { [hidden]: on })} />;",
      classReason,
    );
  });

  it('ignores a className whose only visibility word is in a comment', async () => {
    await assertEvery(
      "export const a = <a className={on ? 'p-2' /* hidden */ : 'm-2'} />;",
      classReason,
    );
  });

  ['overflow-hidden', 'hiddenish', 'hidden-x', 'md:overflow-hidden'].forEach(
    (token) => {
      it(`ignores a className whose only near match is ${token}`, async () => {
        await assertEvery(
          `export const a = <a className={on ? 'p-2' : '${token}'} />;`,
          classReason,
        );
      });
    },
  );

  it('keeps the mutants of a className with a visibility class from visibilityClasses, also as a variant', async () => {
    const options = { lzJsxStyling: { visibilityClasses: ['closed'] } };

    await assertEvery(
      "export const a = <a className={on ? 'p-2' : 'closed'} />;",
      'placed',
      options,
    );
    await assertEvery(
      "export const a = <a className={on ? 'p-2' : 'max-md:closed'} />;",
      'placed',
      options,
    );
    await assertEvery(
      "export const a = <a className={on ? 'p-2' : 'hidden'} />;",
      'placed',
      options,
    );
  });

  it('ignores a class the default list lacks when visibilityClasses does not name it', async () => {
    await assertEvery(
      "export const a = <a className={on ? 'p-2' : 'closed'} />;",
      classReason,
    );
  });

  it('ignores a className that holds none of the visibilityClasses', async () => {
    await assertEvery(
      "export const a = <a className={on ? 'p-2' : 'm-2'} />;",
      classReason,
      { lzJsxStyling: { visibilityClasses: ['was', 'here'] } },
    );
  });

  [
    'cn',
    'clsx',
    'classnames',
    'classNames',
    'cx',
    'twMerge',
    'cva',
    'tv',
  ].forEach((callee) => {
    it(`ignores every mutant in a ${callee} call outside an attribute, with the builder reason`, async () => {
      await assertEvery(
        `export const c = ${callee}('p-2', on && 'bg-accent');`,
        builderReason,
      );
    });
  });

  it('keeps the mutants of a class builder call that can add a visibility class', async () => {
    await assertEvery(
      "export const c = cn('p-2', on && 'max-md:hidden');",
      'placed',
    );
  });

  ['format', 'lib.cn', 'cn.call', 'new cn'].forEach((callee) => {
    it(`keeps the mutants of a ${callee} call`, async () => {
      await assertEvery(
        `export const c = ${callee}('p-2', on && 'bg-accent');`,
        'placed',
      );
    });
  });

  it('keeps the mutants of a class builder call inside a className that can add a visibility class', async () => {
    await assertEvery(
      "export const a = <a className={on ? 'hidden' : cn('p-2', b && 'm-2')} />;",
      'placed',
    );
  });

  [
    "export const buttonClassName = 'p-2 m-2';",
    'export const sizeClasses = `p-${size} m-2`;',
    "export const variantClasses = { primary: 'bg-blue', ghost: 'bg-none' };",
  ].forEach((code) => {
    it(`ignores every mutant of a class variable: ${code}`, async () => {
      await assertEvery(code, classReason);
    });
  });

  [
    "export const label = 'p-2 m-2';",
    "export const buttonClassName = pick('p-2', 'm-2');",
    "export const toggleClasses = { open: 'block', closed: 'hidden' };",
  ].forEach((code) => {
    it(`keeps the mutants of ${code}`, async () => {
      await assertEvery(code, 'placed');
    });
  });

  it('ignores every mutant in a style object of paint-only keys', async () => {
    await assertEvery(
      "export const a = <a style={{ color: on ? 'red' : 'blue', 'background-color': `#${hex}`, boxShadow: on ? 'none' : 'x' }} />;",
      styleReason,
    );
  });

  [
    'color',
    'background',
    'backgroundColor',
    'backgroundImage',
    'borderColor',
    'borderTopColor',
    'borderRightColor',
    'borderBottomColor',
    'borderLeftColor',
    'borderRadius',
    'outlineColor',
    'boxShadow',
    'textShadow',
    'textDecorationColor',
    'accentColor',
    'caretColor',
    'cursor',
    'fill',
    'stroke',
    "'border-radius'",
  ].forEach((key) => {
    it(`ignores the mutants of a style object with only the paint key ${key}`, async () => {
      await assertEvery(
        `export const a = <a style={{ ${key}: on ? 'a' : 'b' }} />;`,
        styleReason,
      );
    });
  });

  it('ignores a style object whose only hidden word is in a value', async () => {
    await assertEvery(
      "export const a = <a style={{ color: on ? 'hidden' : 'blue' }} />;",
      styleReason,
    );
  });

  [
    'display',
    'visibility',
    'width',
    'height',
    'transform',
    'position',
    'opacity',
    'border',
    'padding',
    'paddingTop',
    'margin',
    'gap',
    'fontSize',
    'zIndex',
    "'pointer-events'",
    "'animation-delay'",
    "'maxHeight'",
  ].forEach((key) => {
    it(`keeps the mutants of a style object with the key ${key}`, async () => {
      await assertEvery(
        `export const a = <a style={{ color: on ? 'red' : 'blue', ${key}: on ? 'a' : 'b' }} />;`,
        'placed',
      );
    });
  });

  [
    ['a spread', "{{ ...base, color: on ? 'red' : 'blue' }}"],
    ['a computed key', "{{ [prop]: on ? 'red' : 'blue' }}"],
    [
      'a computed key named like a paint key',
      "{{ [color]: on ? 'red' : 'blue' }}",
    ],
    ['a value that is not an object literal', "{styleOf(on ? 'red' : 'blue')}"],
  ].forEach(([title, value]) => {
    it(`keeps the mutants of a style with ${title}`, async () => {
      await assertEvery(`export const a = <a style=${value} />;`, 'placed');
    });
  });

  [
    'closed',
    null,
    {},
    [1],
    [''],
    ['is closed'],
    [' closed'],
    ['closed\t'],
    ['closed', null],
  ].forEach((visibilityClasses) => {
    it(`refuses visibilityClasses ${JSON.stringify(visibilityClasses)} when it is created`, () => {
      assert.throws(
        () => stylingIgnorer({ lzJsxStyling: { visibilityClasses } }),
        {
          message: `@layzee/stryker-jsx-mutators: lzJsxStyling.visibilityClasses must be an array of class names, each without whitespace, not ${JSON.stringify(visibilityClasses)}.`,
        },
      );
    });
  });

  [
    {},
    { lzJsxStyling: {} },
    { lzJsxStyling: { visibilityClasses: [] } },
  ].forEach((options) => {
    it(`accepts the options ${JSON.stringify(options)}`, () => {
      assert.doesNotThrow(() => stylingIgnorer(options));
    });
  });

  it('ignores a className after a Stryker restore comment', async () => {
    await assertEvery(
      "// Stryker disable StringLiteral\n// Stryker restore StringLiteral\nexport const a = <a className={on ? 'a' : 'b'} />;",
      classReason,
    );
  });

  ['data-state', 'classNames', 'classNameFor'].forEach((name) => {
    it(`keeps the mutants of a ${name} attribute`, async () => {
      await assertEvery(
        `export const a = <a ${name}={on ? 'a' : 'b'} />;`,
        'placed',
      );
    });
  });

  it('keeps the mutants of an object literal in an attribute other than style', async () => {
    await assertEvery(
      "export const a = <a data-style={{ color: on ? 'red' : 'blue' }} />;",
      'placed',
    );
  });

  it('keeps the mutants of a className whose value is an element, not an expression', async () => {
    await assertEvery(
      'export const a = <a className=<b onClick={() => go(true)} /> />;',
      'placed',
    );
  });
});

describe('strykerValidationSchema', () => {
  const unknownOption = /^warn Unknown stryker config option "lzJsxStyling"/;

  it('describes lzJsxStyling.visibilityClasses as a list of class names', () => {
    assert.deepEqual(strykerValidationSchema, {
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      properties: {
        lzJsxStyling: {
          type: 'object',
          additionalProperties: false,
          description: 'Options of the lz-jsx-styling ignorer.',
          properties: {
            visibilityClasses: {
              type: 'array',
              items: { type: 'string', pattern: '^\\S+$' },
              description:
                'Class names that hide an element, added to the built-in ones. lz-jsx-styling keeps the mutants of ' +
                'a class expression that holds one of them.',
            },
          },
        },
      },
    });
  });

  it('lets core accept lzJsxStyling without the unknown-option warning it gives when the schema is missing', async () => {
    const options = { lzJsxStyling: { visibilityClasses: ['closed'] } };
    const without = await validateOptions(options, []);
    const withSchema = await validateOptions(options, [
      strykerValidationSchema,
    ]);

    assert.equal(without.valid, true);
    assert.ok(without.log.some((line) => unknownOption.test(line)));
    assert.deepEqual(withSchema, { valid: true, log: [] });
  });

  [
    { visibilityClasses: 'closed' },
    { visibilityClasses: [1] },
    { visibilityClasses: [''] },
    { visibilityClasses: ['is closed'] },
    { classes: ['closed'] },
    [],
    'closed',
  ].forEach((lzJsxStyling) => {
    it(`lets core refuse lzJsxStyling ${JSON.stringify(lzJsxStyling)}`, async () => {
      const { valid, log } = await validateOptions({ lzJsxStyling }, [
        strykerValidationSchema,
      ]);

      assert.equal(valid, false);
      assert.ok(
        log.some(
          (line) => line.startsWith('error') && line.includes('lzJsxStyling'),
        ),
        log.join('\n'),
      );
    });
  });
});
