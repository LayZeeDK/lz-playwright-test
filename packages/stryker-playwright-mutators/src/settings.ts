import { inspect } from 'node:util';

import { fieldOf, isRecord } from '@layzee/stryker-mutator-install';

import { packageName } from './package-name.ts';

export interface LzPlaywrightMutatorSettings {
  readonly navigationFixtures?: readonly string[];
}

export interface ResolvedSettings {
  readonly navigationFixtures: readonly string[];
}

const identifier = /^[\p{ID_Start}$_][\p{ID_Continue}$\u{200C}\u{200D}]*$/u;

function isIdentifierList(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.every((entry) => typeof entry === 'string' && identifier.test(entry))
  );
}

let current = parseSettings(undefined);

/** The settings of the latest install call; every call replaces them. */
export function useSettings(settings: ResolvedSettings): void {
  current = settings;
}

export function navigationFixtures(): readonly string[] {
  return current.navigationFixtures;
}

export function parseSettings(settings: unknown): ResolvedSettings {
  if (
    settings !== undefined &&
    (!isRecord(settings) || Array.isArray(settings))
  ) {
    throw new Error(
      `${packageName}: the settings must be an object, not ${inspect(settings)}.`,
    );
  }

  const unknown = Object.keys(settings ?? {}).find(
    (key) => key !== 'navigationFixtures',
  );

  if (unknown !== undefined) {
    throw new Error(
      `${packageName}: the settings have no key ${unknown}; the keys are navigationFixtures.`,
    );
  }

  const given = fieldOf(settings, 'navigationFixtures');
  const list = given === undefined ? ['navigate'] : given;

  if (!isIdentifierList(list)) {
    throw new Error(
      `${packageName}: navigationFixtures takes an array of identifier names, not ${inspect(list)}.`,
    );
  }

  return { navigationFixtures: list };
}
