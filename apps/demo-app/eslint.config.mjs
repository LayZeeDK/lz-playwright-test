import nx from '@nx/eslint-plugin';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import baseConfig, { withWarningsAsErrors } from '../../eslint.config.mjs';

export default withWarningsAsErrors([
  ...nx.configs['flat/react'],
  ...baseConfig,
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    // Not flatConfigs.strict whole: its plugin object differs from the package export that flat/react
    // registers, and ESLint refuses two objects under one plugin name.
    plugins: { 'jsx-a11y': jsxA11y },
    rules: jsxA11y.flatConfigs.strict.rules,
  },
]);
