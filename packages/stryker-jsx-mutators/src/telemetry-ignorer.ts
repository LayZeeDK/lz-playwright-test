import { bindingOf, fieldOf } from '@layzee/stryker-mutator-install';
import type { Ignorer } from '@stryker-mutator/api/ignore';
import { commonTokens, tokens } from '@stryker-mutator/api/plugin';

import { packageName } from './package-name.ts';
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
  const calls = ownCalls(options);

  return {
    shouldIgnore(path) {
      const callee = statementCallee(fieldOf(path, 'node'));

      if (analyticsCalls.includes(callee)) {
        return analyticsReason;
      }

      if (
        errorCalls.includes(callee) ||
        (sentryImportedFunctions.includes(callee) &&
          importsFromSentry(path, callee))
      ) {
        return errorReason;
      }

      if (calls.includes(callee)) {
        return callsReason;
      }

      return undefined;
    },
  };
}
telemetryIgnorer.inject = tokens(commonTokens.options);

function ownCalls(options: object): readonly unknown[] {
  const own = fieldOf(fieldOf(options, 'lzTelemetry'), 'calls');

  if (own === undefined) {
    // Stryker disable next-line ArrayDeclaration: a callee is a dotted name, never "Stryker was here" with its spaces
    return [];
  }

  if (!isCallList(own)) {
    throw new Error(
      `${packageName}: lzTelemetry.calls must be an array of callee names such as track or analytics.track, ` +
        `not ${JSON.stringify(own)}.`,
    );
  }

  return own;
}

function isCallList(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.every(
      (name: unknown) => typeof name === 'string' && calleePattern.test(name),
    )
  );
}

function importsFromSentry(path: unknown, name: unknown): boolean {
  const declaration = fieldOf(fieldOf(bindingOf(path, name), 'path'), 'parent');
  const source = fieldOf(fieldOf(declaration, 'source'), 'value');

  return typeof source === 'string' && source.startsWith('@sentry/');
}
