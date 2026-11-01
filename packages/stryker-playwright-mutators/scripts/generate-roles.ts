import { join } from 'node:path';

import { pluginName } from '../src/plugin-name.ts';
import { generateRoles } from './roles-generator.ts';

try {
  generateRoles(
    join(import.meta.dirname, '..', 'package.json'),
    join(import.meta.dirname, '..', 'src', 'bundled-roles.ts'),
  );
} catch (error) {
  process.stderr.write(
    `${pluginName} build: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
}
