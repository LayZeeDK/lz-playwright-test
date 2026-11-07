import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  strykerValidationSchema,
  telemetryIgnorer,
} from '../src/telemetry-ignorer.ts';
import { assertEveryOutcome } from './support/ignorer-outcomes.ts';
import { validateOptions } from './support/validate-options.ts';

const analyticsReason =
  'lz-telemetry: analytics call; DOM tests do not observe what it sends';
const callsReason =
  'lz-telemetry: telemetry call from lzTelemetry.calls; DOM tests do not observe what it sends';
const errorReason =
  'lz-telemetry: error-monitoring call; DOM tests do not observe what it reports';

const assertEvery = (code: string, outcome: string, options: object = {}) =>
  assertEveryOutcome(telemetryIgnorer(options), code, outcome);

describe('lz-telemetry', () => {
  it('ignores every mutant of a gtag call statement, with the analytics reason', async () => {
    await assertEvery(
      "gtag('event', 'sign_up', { method: on ? 'a' : 'b' });",
      analyticsReason,
    );
  });

  [
    'gtag',
    'window.gtag',
    'fbq',
    'ttq.track',
    'dataLayer.push',
    'window.dataLayer.push',
    'analytics.track',
    'analytics.page',
    'analytics.identify',
    'analytics.group',
    'analytics.alias',
    'analytics.screen',
    'posthog.capture',
    'posthog.identify',
    'posthog.group',
    'posthog.alias',
    'posthog.register',
    'posthog.reset',
    'mixpanel.track',
    'mixpanel.identify',
    'mixpanel.register',
    'mixpanel.people.set',
    'plausible',
    'window.plausible',
    'umami.track',
    'amplitude.track',
    'amplitude.logEvent',
    'amplitude.identify',
  ].forEach((callee) => {
    it(`ignores every mutant of a ${callee} call statement, with the analytics reason`, async () => {
      await assertEvery(
        `${callee}('event', { plan: on ? 'a' : 'b' });`,
        analyticsReason,
      );
    });
  });

  [
    'Sentry.captureException',
    'Sentry.captureMessage',
    'Sentry.addBreadcrumb',
    'Sentry.setUser',
    'Sentry.setTag',
    'Sentry.setTags',
    'Sentry.setContext',
    'Sentry.setExtra',
    'Sentry.flush',
  ].forEach((callee) => {
    it(`ignores every mutant of a ${callee} call statement, with the error-monitoring reason`, async () => {
      await assertEvery(
        `${callee}(on ? 'a' : 'b', { level: 'warning' });`,
        errorReason,
      );
    });
  });

  ['captureException', 'captureMessage'].forEach((name) => {
    it(`ignores every mutant of a ${name} call statement when ${name} comes from a @sentry package`, async () => {
      await assertEvery(
        `import { ${name} } from '@sentry/react-router';\n${name}(on ? 'a' : 'b');`,
        errorReason,
      );
    });
  });

  [
    '',
    "import { captureException } from './errors';\n",
    "import { captureException } from 'sentry';\n",
    "import { captureMessage } from '@sentry/node';\n",
    "import { captureException as report } from '@sentry/node';\n",
    "export { captureException } from '@sentry/node';\n",
  ].forEach((imports) => {
    it(`keeps the mutants of a bare captureException call statement after ${JSON.stringify(imports)}`, async () => {
      await assertEvery(
        `${imports}captureException(on ? 'a' : 'b');`,
        'placed',
      );
    });
  });

  [
    'window.gtag?.',
    'window.dataLayer?.push',
    'window?.dataLayer?.push',
  ].forEach((callee) => {
    it(`ignores every mutant of an optional call statement ${callee}()`, async () => {
      await assertEvery(
        `${callee}('event', { plan: on ? 'a' : 'b' });`,
        analyticsReason,
      );
    });
  });

  ['await', 'void'].forEach((operator) => {
    it(`ignores every mutant of a telemetry call statement under ${operator}`, async () => {
      await assertEvery(
        `${operator} Sentry.flush(on ? 2000 : 0, 'a');`,
        errorReason,
      );
    });
  });

  it('keeps the mutants of Sentry.init, whose options unit tests can check', async () => {
    await assertEvery(
      "Sentry.init({ dsn: on ? 'a' : 'b', beforeSend: (event) => (on ? null : event) });",
      'placed',
    );
  });

  [
    "export const id = analytics.track('event', on ? 'a' : 'b');",
    "export function f() { return gtag('event', on ? 'a' : 'b'); }",
    "sent = posthog.capture('event', on ? 'a' : 'b');",
    "track(analytics.track('event', on ? 'a' : 'b'));",
  ].forEach((code) => {
    it(`keeps the mutants of a telemetry call whose result is used: ${code}`, async () => {
      await assertEvery(code, 'placed');
    });
  });

  [
    'new gtag',
    'new analytics.track',
    "analytics['track']",
    'lib.analytics.track',
    'analytics.track.call',
  ].forEach((callee) => {
    it(`keeps the mutants of a ${callee} statement`, async () => {
      await assertEvery(`${callee}('event', on ? 'a' : 'b');`, 'placed');
    });
  });

  ['track', 'telemetry.send'].forEach((callee) => {
    it(`ignores every mutant of a ${callee} call statement listed in lzTelemetry.calls, with the calls reason`, async () => {
      await assertEvery(`${callee}('event', on ? 'a' : 'b');`, callsReason, {
        lzTelemetry: { calls: ['track', 'telemetry.send'] },
      });
    });
  });

  [
    'track',
    null,
    {},
    [1],
    [''],
    ['a b'],
    ['a.'],
    ['.a'],
    ['a..b'],
    ['a-b'],
    ['a[0]'],
    ['a()'],
    ['track', null],
  ].forEach((calls) => {
    it(`refuses calls ${JSON.stringify(calls)} when it is created`, () => {
      assert.throws(() => telemetryIgnorer({ lzTelemetry: { calls } }), {
        message: `@layzee/stryker-jsx-mutators: lzTelemetry.calls must be an array of callee names such as track or analytics.track, not ${JSON.stringify(calls)}.`,
      });
    });
  });

  [
    {},
    { lzTelemetry: {} },
    { lzTelemetry: { calls: [] } },
    { lzTelemetry: { calls: ['$track', '_t.send', 'a1.b2.c3'] } },
  ].forEach((options) => {
    it(`accepts the options ${JSON.stringify(options)}`, () => {
      assert.doesNotThrow(() => telemetryIgnorer(options));
    });
  });

  it('keeps the mutants of a call statement to an unknown callee', async () => {
    await assertEvery("format('a', on ? 'b' : 'c');", 'placed');
  });
});

describe('the lz-telemetry strykerValidationSchema', () => {
  it('describes lzTelemetry.calls as a list of callee names', () => {
    assert.deepEqual(strykerValidationSchema, {
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      properties: {
        lzTelemetry: {
          type: 'object',
          additionalProperties: false,
          description: 'Options of the lz-telemetry ignorer.',
          properties: {
            calls: {
              type: 'array',
              items: {
                type: 'string',
                pattern: '^[A-Za-z_$][\\w$]*(\\.[A-Za-z_$][\\w$]*)*$',
              },
              description:
                'Callees, such as track or analytics.track, added to the built-in ones. lz-telemetry hides the ' +
                'mutants of a statement that only calls one of them.',
            },
          },
        },
      },
    });
  });

  it('lets core accept lzTelemetry without an unknown-option warning', async () => {
    assert.deepEqual(
      await validateOptions({ lzTelemetry: { calls: ['track'] } }, [
        strykerValidationSchema,
      ]),
      { valid: true, log: [] },
    );
  });

  [
    { calls: 'track' },
    { calls: [1] },
    { calls: ['a b'] },
    { callees: ['track'] },
    [],
  ].forEach((lzTelemetry) => {
    it(`lets core refuse lzTelemetry ${JSON.stringify(lzTelemetry)}`, async () => {
      const { valid, log } = await validateOptions({ lzTelemetry }, [
        strykerValidationSchema,
      ]);

      assert.equal(valid, false);
      assert.ok(
        log.some(
          (line) => line.startsWith('error') && line.includes('lzTelemetry'),
        ),
        log.join('\n'),
      );
    });
  });
});
