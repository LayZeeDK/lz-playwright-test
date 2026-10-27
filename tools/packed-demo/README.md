# Packed demo: the demo app on the packed tarballs

This folder holds what a scratch project outside the workspace needs to run the demo's e2e Stryker run with
the UI operators on the two packed packages, with no workspace links. `docs/VERDICT.md` (Evidence) has the
result. The configs are plain JavaScript versions of the demo's Vite, Playwright and `stryker.e2e.ui.config.ts`
settings, without Nx.

From the repo root, with `<scratch>` the absolute path of a new folder outside the repo (the two `npm pack`
lines run from a package folder). The `rm` line drops the story file, which belongs to the component tests
that this project does not run.

```sh
npx nx run-many -t build
mkdir -p <scratch>/app <scratch>/e2e <scratch>/tarballs
cp tools/packed-demo/*.json tools/packed-demo/*.mjs <scratch>/
cp -r apps/demo-app/index.html apps/demo-app/src apps/demo-app/public <scratch>/app/
rm <scratch>/app/src/app/price-tag.story.tsx
cp apps/demo-app-e2e/src/*.spec.ts <scratch>/e2e/
(cd packages/lz-stryker-playwright-runner && npm pack --pack-destination <scratch>/tarballs)
(cd packages/lz-stryker-ui-mutators && npm pack --pack-destination <scratch>/tarballs)
cd <scratch>
npm install --ignore-scripts
npx playwright install chromium
node --no-experimental-strip-types --input-type=module -e "await import('@layzee/lz-stryker-playwright-runner'); await import('@layzee/lz-stryker-ui-mutators')"
npx playwright test
npx stryker run stryker.config.mjs
```

No dependency needs an install script, so `--ignore-scripts` keeps registry code from running on the host
during the install. The project has no lockfile, so transitive dependencies resolve fresh on each install:
with one, npm would take each tarball's contents from its cache by the recorded integrity and install the
old package after a repack.

The `node` line imports both packages with type stripping turned off, so it fails if anything in them is
TypeScript. The dev server listens on 127.0.0.1, on port 4500 outside Stryker and 4600 plus the worker number
under it.

To compare the result with the workspace's own run of `stryker.e2e.ui.config.ts`, from the repo root:

```sh
node tools/compare-mutation-reports.ts reports/e2e-ui/mutation.json <scratch>/reports/mutation.json --status
```

It exits 0 when both reports list the same mutants with the same statuses.
