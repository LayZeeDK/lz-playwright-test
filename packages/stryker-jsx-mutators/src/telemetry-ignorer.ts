import { bindingOf, fieldOf } from '@layzee/stryker-mutator-install';
import type { Ignorer } from '@stryker-mutator/api/ignore';
import { commonTokens, tokens } from '@stryker-mutator/api/plugin';

import { listOption } from './list-option.ts';
import { statementCallee } from './statement-call.ts';

const calleePattern = /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/;

export const strykerValidationSchema = {
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
          items: { type: 'string', pattern: calleePattern.source },
          description:
            'Callees, such as track or analytics.track, added to the built-in ones. lz-telemetry hides the ' +
            'mutants of a statement that only calls one of them.',
        },
      },
    },
  },
};

const analyticsReason =
  'lz-telemetry: analytics call; DOM tests do not observe what it sends';
const analyticsCalls: readonly unknown[] = [
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
];
const errorReason =
  'lz-telemetry: error-monitoring call; DOM tests do not observe what it reports';
const errorCalls: readonly unknown[] = [
  'Sentry.captureException',
  'Sentry.captureMessage',
  'Sentry.addBreadcrumb',
  'Sentry.setUser',
  'Sentry.setTag',
  'Sentry.setTags',
  'Sentry.setContext',
  'Sentry.setExtra',
  'Sentry.flush',
];
const sentryImportedFunctions: readonly unknown[] = [
  'captureException',
  'captureMessage',
];

const callsReason =
  'lz-telemetry: telemetry call from lzTelemetry.calls; DOM tests do not observe what it sends';

export function telemetryIgnorer(options: object): Ignorer {
  const calls = listOption(
    options,
    'lzTelemetry',
    'calls',
    [],
    isCallee,
    'an array of callee names such as track or analytics.track',
  );
  const reasons = new Map<unknown, string>([
    ...calls.map((callee) => [callee, callsReason] as const),
    ...analyticsCalls.map((callee) => [callee, analyticsReason] as const),
    ...errorCalls.map((callee) => [callee, errorReason] as const),
  ]);

  return {
    shouldIgnore(path) {
      const callee = statementCallee(fieldOf(path, 'node'));

      return sentryImportedFunctions.includes(callee) &&
        importsFromSentry(path, callee)
        ? errorReason
        : reasons.get(callee);
    },
  };
}
telemetryIgnorer.inject = tokens(commonTokens.options);

function isCallee(name: unknown): name is string {
  return typeof name === 'string' && calleePattern.test(name);
}

function importsFromSentry(path: unknown, name: unknown): boolean {
  const declaration = fieldOf(fieldOf(bindingOf(path, name), 'path'), 'parent');
  const source = fieldOf(fieldOf(declaration, 'source'), 'value');

  return typeof source === 'string' && source.startsWith('@sentry/');
}
