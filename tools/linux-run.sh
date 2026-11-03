#!/usr/bin/env bash
# Runs inside mcr.microsoft.com/playwright:v1.64.1-noble with /out mounted. /out/head.tar is `git archive HEAD`.
# Exits with the number of failed steps, or 1 when the archive cannot be unpacked; /out/summary.txt has each
# step's exit code and time.
set -uo pipefail

mkdir /w && tar -C /w -xf /out/head.tar && cd /w || exit 1
{ uname -m; node -v; npm -v; } | tee /out/env.txt
failed=0

step() {
  local name=$1
  shift
  local start=$SECONDS
  echo "== $name"
  timeout 1800 "$@" >"/out/$name.log" 2>&1
  local code=$?
  echo "$name exit=$code $((SECONDS - start))s" | tee -a /out/summary.txt

  if [ "$code" -ne 0 ]; then
    failed=$((failed + 1))
  fi
}

: >/out/summary.txt
step npm-ci npm ci --no-audit --no-fund
# Without node_modules, npx would download whatever nx the registry serves.
[ "$failed" -eq 0 ] || exit "$failed"
step nx-lint npx nx run-many -t lint --projects=@layzee/stryker-playwright-runner,@layzee/stryker-jsx-mutators
step nx-typecheck npx nx run-many -t typecheck
step nx-build npx nx run-many -t build --projects=@layzee/stryker-playwright-runner,@layzee/stryker-jsx-mutators
step test-runner npx nx run @layzee/stryker-playwright-runner:test
step test-ui npx nx run @layzee/stryker-jsx-mutators:test
step test-browser npx nx run @layzee/stryker-playwright-runner:test-browser
step stryker-e2e npx nx run @layzee/demo-app-e2e:mutate-e2e
step stryker-e2e-ui npx nx run @layzee/demo-app-e2e:mutate-e2e-ui
step stryker-ct npx nx run @layzee/demo-app:mutate-ct

for report in e2e e2e-ui ct; do
  if [ -f "reports/$report/mutation.json" ]; then
    cp "reports/$report/mutation.json" "/out/$report-mutation.json"
  fi
done

exit "$failed"
