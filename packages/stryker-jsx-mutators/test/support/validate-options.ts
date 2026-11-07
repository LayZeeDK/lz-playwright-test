import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { strykerCoreSchema } from '@stryker-mutator/api/core';

import { corePackageJson } from '../../src/install.ts';
import { exportedFunction } from './exports.ts';

export async function validateOptions(
  options: object,
  contributions: readonly object[],
) {
  const config: unknown = await import(
    pathToFileURL(
      join(dirname(corePackageJson()), 'dist', 'src', 'config', 'index.js'),
    ).href
  );
  const log: string[] = [];
  const record = (level: string) => (message: unknown) => {
    log.push(`${level} ${String(message)}`);
  };
  const logger = {
    debug: () => undefined,
    info: () => undefined,
    warn: record('warn'),
    error: record('error'),
    trace: () => undefined,
    fatal: () => undefined,
    isDebugEnabled: () => false,
    isTraceEnabled: () => false,
  };
  const builder: unknown = Reflect.construct(
    exportedFunction(config, 'MetaSchemaBuilder'),
    [strykerCoreSchema, logger],
  );
  const schema: unknown = Reflect.apply(
    exportedFunction(builder, 'buildMetaSchema'),
    builder,
    [contributions],
  );
  const validator: unknown = Reflect.construct(
    exportedFunction(config, 'OptionsValidator'),
    [schema, logger],
  );

  try {
    Reflect.apply(exportedFunction(validator, 'validate'), validator, [
      structuredClone(options),
      true,
    ]);

    return { valid: true, log };
  } catch {
    return { valid: false, log };
  }
}
