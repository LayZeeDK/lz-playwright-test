#!/usr/bin/env bash
# Runs inside mcr.microsoft.com/playwright:v1.64.1-noble with /out mounted. /out/head.tar is `git archive HEAD`.
set -uo pipefail

mkdir /w && tar -C /w -xf /out/head.tar && cd /w || exit 1
{ uname -m; node -v; npm -v; } | tee /out/env.txt

step() {
  local name=$1
  shift
  local start=$SECONDS
  echo "== $name"
  timeout 1800 "$@" >"/out/$name.log" 2>&1
  local code=$?
  echo "$name exit=$code $((SECONDS - start))s" | tee -a /out/summary.txt
}

: >/out/summary.txt
step npm-ci npm ci --no-audit --no-fund
step nx-lint npx nx run-many -t lint --projects=@layzee/lz-stryker-playwright-runner,@layzee/lz-stryker-ui-mutators
step nx-typecheck npx nx run-many -t typecheck
step nx-build npx nx run-many -t build --projects=@layzee/lz-stryker-playwright-runner,@layzee/lz-stryker-ui-mutators
step test-runner npx nx run @layzee/lz-stryker-playwright-runner:test
step test-ui npx nx run @layzee/lz-stryker-ui-mutators:test
step test-browser npx nx run @layzee/lz-stryker-playwright-runner:test-browser
step tsc-tools npx tsc -p tsconfig.tools.json
step stryker-e2e npx nx run @layzee/demo-app-e2e:mutate-e2e
step stryker-e2e-ui npx nx run @layzee/demo-app-e2e:mutate-e2e-ui
step stryker-ct npx nx run @layzee/demo-app:mutate-ct

for report in e2e e2e-ui ct; do
  [ -f "reports/$report/mutation.json" ] && cp "reports/$report/mutation.json" "/out/$report-mutation.json"
done
