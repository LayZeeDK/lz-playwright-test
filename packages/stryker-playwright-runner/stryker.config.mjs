import { packageConfig } from '../../stryker.package.ts';

// worker-hook.ts hands initPage and readNamespace's evaluate callback to the page as source text, where an
// instrumented copy would call a namespace the page does not have. Mutating them is safe only while no test in
// the run opens a real page: test/*.test.ts open none, and the browser tests are a separate target.
export default packageConfig('stryker-playwright-runner');
