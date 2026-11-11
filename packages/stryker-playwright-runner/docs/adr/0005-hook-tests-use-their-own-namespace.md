# The hooks' tests install the hooks on a namespace of their own

The worker hook, the server hook and the script they add to pages put accessors on Stryker's global, `__stryker__`,
to switch the active mutant per request and count hits. When Stryker mutates this package, the instrumented copies
of those files use the same global in the test process, so a hook under test reads through itself: with
`server-hook.ts` instrumented, all 29 of its tests failed. The tests therefore set
`LZ_STRYKER_PLAYWRIGHT_HOOK_TEST_NAMESPACE` to `__stryker_hook_test__` and install the hooks under test on that
global, while instrumented code keeps `__stryker__`. The runner never sets the variable, and an unset or empty value
means `__stryker__`. With that, the package's Stryker config mutates all of `src`, and all 611 tests passed against
fully instrumented hook files.

## Considered Options

- Leave the nine files that the hooks load out of `mutate`, as the config did before. It needs no environment
  variable, but leaves the code that decides coverage and the active mutant without mutation testing.
