import { packageConfig } from '../../stryker.package.ts';

// copies.test.ts checks that src/stub-shape.ts is a byte copy of stryker-storybook's, which Stryker's instrumented copy never is.
export default packageConfig('storybook-mock-transformer', [
  'index.test.ts',
  'transform.test.ts',
]);
