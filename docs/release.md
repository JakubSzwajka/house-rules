# Release

This file covers House Rules package releases to npm. App release and deploy workflows are not kept in this repo.

## Packages

Two packages publish: `@house-rules/rules` (plain JavaScript, no build) and `@house-rules/stack` (built to `dist/` by `tsconfig.build.json`; the workspace reads `src/`). Every other workspace package is private. The retired packages (`capability`, `domain`, `application`, the hosts, the plugs and the old modules) keep their last versions on npm and are never published again. Deprecating them on npm needs separate approval.

For local package testing without npm, see [the local framework registry guide](local-registry.md).

## The workflow

The npm packages use `.github/workflows/publish.yml`. It starts on package tag pushes (`@house-rules/<pkg>@<version>`) and manual runs. Pull requests trigger it only for changes to the workflow, `scripts/tag-published.mjs`, `scripts/packed-*.mjs`, `scripts/tarball-content.mjs`, `tests/publish-workflow*.mjs` and `tests/tag-published*.mjs`. Other changes use `ci.yml` alone.

The read-only `verify` job runs check, test, build, the packed consumer and `pnpm publish -r --dry-run`. It has `contents: read` only, no npm token and no OIDC. Its first step refuses a manual publish run from any ref but exactly `refs/heads/main`. After it passes, the `publish` job runs `pnpm publish -r --access public --provenance --no-git-checks --report-summary`. `pnpm publish -r` skips private packages and versions already on the registry, so one run publishes exactly the bumped packages.

Only after that command succeeds, `scripts/tag-published.mjs` reads `pnpm-publish-summary.json`. It creates `@house-rules/<pkg>@<version>` tags for the packages the report says were published, then pushes those tags atomically. A summary naming a retired package fails. A tag already at the published commit stays untouched; a tag at another commit fails the job rather than moving it.

Only the publish job has `contents: write`, needed to push those tags. Its checkout uses `persist-credentials: false`. The tagging step alone receives `GITHUB_TOKEN` through command-scoped Git config. GitHub does not trigger workflows from `GITHUB_TOKEN` pushes, so new tags cannot start a second publish run.

## Prepare a release

1. Bump the package version and every workspace pin on it together, with the owner's approval.
2. Keep `@house-rules/stack`'s peer dependencies on the exact Effect and Alchemy versions the workspace pins.
3. Run `pnpm check`, `pnpm test` and `pnpm run packed-consumer` locally.
4. Merge, then push the package tag or run the workflow manually on main. Never publish by hand.

Before the first `@house-rules/stack` release, confirm the `NPM_TOKEN` owner can create the new package in the scope. A token limited to existing packages will not cover it. Consumers wait 24 hours after a publication under the release-age policy; any exception needs owner approval.

## If tagging failed

A workflow rerun may publish nothing, leaving an empty summary; normal tagging then does nothing. A missing summary fails the tagging step with a recovery hint. Do not bump versions or republish to fix tags.

1. In a clean checkout, fetch tags and check out the exact release commit from the failed run. Confirm `git rev-parse HEAD` matches that run. Use the recovery script from a newer checkout if the release commit lacks it.
2. Run `node /path/to/scripts/tag-published.mjs --recover --dry-run` from that release checkout. It reads the known workspace manifests (rules and stack, plus every retired package, which only recovery reads), queries npm for each exact version and reads the SLSA provenance source commit from its attestations. A package qualifies only when the workflow repository is `JakubSzwajka/house-rules` and the source commit equals HEAD. The dry run makes no Git writes.
3. With approval to push the release tags, rerun without `--dry-run`. Recovery pushes all matching tags atomically and never moves a tag at another commit.

Unpublished versions and versions from another commit are skipped. Missing or unreadable attestations, a foreign repository, malformed provenance and registry failures other than 404 stop recovery before any tag is created. Recovery skips only absent package manifests, so it works at historical commits that predate a package or still hold retired ones. Recovery does not publish anything.
