# Release

This repo carries the reference copy of the release workflow. It is one file, `.github/workflows/release-create.yml`, named **Create release**. It holds every step in plain `run:` blocks, with no helper scripts. A merge to `main` ships nothing. A person runs **Create release** on `main`, and that run is the approval.

The template has no Dockerfile and no health endpoint, so the workflow never runs here. It starts only by hand (`workflow_dispatch`), never on push or pull request. `ci.yml` is separate.

## House Rules package releases

For local package testing without npm, see [the local framework registry guide](local-registry.md).

The npm packages use `.github/workflows/publish.yml`, not the application release flow below. It starts on package tag pushes and manual runs. Pull requests trigger it only for changes to the workflow, `scripts/tag-published.mjs`, `scripts/packed-*.mjs`, `scripts/tarball-content.mjs`, or `tests/publish-workflow*.mjs` and `tests/tag-published*.mjs`. Other package changes use `ci.yml` alone. After its read-only verify job passes, an approved publish job runs `pnpm publish -r --access public --provenance --no-git-checks --report-summary`.

Only after that command succeeds, `scripts/tag-published.mjs` reads `pnpm-publish-summary.json`. It creates `@house-rules/<pkg>@<version>` tags for the packages the report says were published, then pushes those tags atomically. Already-published versions and private packages get no new tag. A tag already at the published commit stays untouched; a tag at another commit fails the job rather than moving it.

Only the publish job has `contents: write`, needed to push those tags. Its checkout uses `persist-credentials: false`; install, build and publish get no stored write token. The tagging step alone receives `GITHUB_TOKEN` and passes its authentication header through command-scoped Git config, not the checkout's config file. GitHub does not trigger workflows from `GITHUB_TOKEN` pushes, so the new package tags cannot start a second publish run. The verify job keeps `contents: read` and has no npm token or OIDC permission.

### Kits release preparation

This section records the earlier kits release preparation, kept as history. The current plan is under "Current 19-package release preparation" below.

Merge first, publish later. This change splits `@house-rules/capability` into two kits and prepares seven public packages:

| Package | Version | Why |
| --- | --- | --- |
| `@house-rules/domain` | 0.1.0 | new: first release |
| `@house-rules/application` | 0.1.0 | new name for the application side of capability: first release |
| `@house-rules/comments` | 0.1.0 | first release; exact peers on domain 0.1.0 and application 0.1.0 |
| `@house-rules/call-audit` | 0.6.0 | exact peer on application 0.1.0 instead of capability |
| `@house-rules/rules` | 0.18.0 | its checks recognise the new kit names and take several apps and packages roots |
| `@house-rules/migrations` | 0.3.0 | unchanged |
| `@house-rules/node-host` | 0.1.0 | unchanged |

`@house-rules/capability` is retired. It stays at 0.16.0 on npm; its unpublished 0.17.0 is dropped, and the workflow never publishes it again. Deprecating it on npm needs a separate approval. Effect and all tools keep their pins.

Before a later approved publish, confirm the `NPM_TOKEN` owner can create `@house-rules/domain`, `@house-rules/application` and `@house-rules/comments` in the scope. A token limited to existing packages will not cover these first releases. The workflow needs its existing OIDC permission for provenance and matching public repository metadata. A local dry run tests packaging, not those npm permissions or provenance signing. Do not manually publish or create a trigger tag to merge this work.

Consumers must wait 24 hours after a future publication under this repo's release-age policy. No `minimumReleaseAgeExclude` entry is added; any exception needs separate owner approval.

### Current 19-package release preparation

Merge first, publish later. This release adds nine support modules and prepares all 19 public packages:

| Package | npm | Release | Why |
| --- | --- | --- | --- |
| `@house-rules/rules` | 0.18.0 | 0.19.0 | - Next treats `src/app` as one way area; route folders are URL paths, not ways.<br>- The v2 correction removes the `nodes` and `modules` area keys and `deliveryLayer`. |
| `@house-rules/domain` | 0.1.0 | 0.2.0 | - The v2 migration replaces nodes, entries and ways with features and package modules.<br>- Operations now use `defineOperation`; features target operations through declared edges. |
| `@house-rules/application` | 0.1.0 | 0.2.0 | - The v2 rewrite replaces entries and the node API with one-file features, operations and package modules.<br>- Runtime mounts now capture bindings once and derive the permission catalogue.<br>- Adds isolated hook, schedule and event ways, system-role access and feature-to-feature edge rejection. |
| `@house-rules/migrations` | 0.3.0 | 0.4.0 | - Migration locations now identify a workspace or package, not a folder path.<br>- Adds SQL health checks for the Node Host's `/healthz` and `/readyz` probes. |
| `@house-rules/call-audit` | 0.6.0 | 0.7.0 | - Mounting now uses the application kit's captured module bindings.<br>- Audit rows gain required target data; direct reads use `AuditReader`. |
| `@house-rules/comments` | 0.1.0 | 0.2.0 | - Comments now exports a `CommentsMount` for application runtime wiring.<br>- Its package operations follow the v2 feature and operation model. |
| `@house-rules/node-host` | 0.1.0 | 0.2.0 | - The v2 migration removes the old node runtime and entry APIs.<br>- Composition now uses the application kit's feature/runtime model.<br>- Adds `/healthz` and `/readyz` probes outside the feature router. |
| `@house-rules/auth-jwt` | not published | 0.1.0 | First release. Clerk preset requires `authorizedParties`; tolerance defaults to 5 seconds. |
| `@house-rules/identity` | not published | 0.1.0 | First release. `ActorStanding` is now a required slot. |
| `@house-rules/party` | not published | 0.1.0 | First release. `lockActive` answers `PersonNotFound` to person callers for disabled principals. |
| `@house-rules/work-items` | not published | 0.1.0 | First release. |
| `@house-rules/notes` | not published | 0.1.0 | First release. |
| `@house-rules/relations` | not published | 0.1.0 | First release. |
| `@house-rules/event-log` | not published | 0.1.0 | First release. |
| `@house-rules/contacts` | not published | 0.1.0 | First release. |
| `@house-rules/notifications` | not published | 0.1.0 | First release. |
| `@house-rules/push` | not published | 0.1.0 | First release. |
| `@house-rules/email` | not published | 0.1.0 | First release. |
| `@house-rules/projects` | not published | 0.1.0 | First release. |

The exact workspace pins move together with these package versions. The support modules peer on the released kits and ship `AGENTS.md`, `README.md`, and migrations where declared.

Before publishing, confirm the `NPM_TOKEN` owner can create `@house-rules/auth-jwt`, `@house-rules/identity`, `@house-rules/party`, `@house-rules/work-items`, `@house-rules/notes`, `@house-rules/relations`, `@house-rules/event-log`, `@house-rules/contacts`, `@house-rules/notifications`, `@house-rules/push`, `@house-rules/email` and `@house-rules/projects` in the scope. These 12 names have never been published. A token limited to existing packages will not cover them.

### Party and auth release preparation (history)

Merge first, publish later. This change adds sign-in and people as three new public packages, moves every exact peer on the application kit to its new version, and adds static files to the Node Host:

| Package | Version | Why |
| --- | --- | --- |
| `@house-rules/auth-jwt` | 0.1.0 | new: first release; fills `Authenticator`; depends on `jose` 6.2.12 |
| `@house-rules/identity` | 0.1.0 | new: first release; identity bindings, `ActorResolver`, `FirstSignIn`, `Identity.caller` |
| `@house-rules/party` | 0.1.0 | new: first release; Person records keyed by `ActorId` |
| `@house-rules/application` | 0.2.0 | new public API: `Principal`, `Authenticator`, `TokenRejected`, `tokenFrom`, `protectedResource`; 0.1.0 is on npm |
| `@house-rules/comments` | 0.2.0 | exact peer on application 0.2.0 instead of 0.1.0 |
| `@house-rules/call-audit` | 0.7.0 | exact peer on application 0.2.0 instead of 0.1.0 |
| `@house-rules/domain` | 0.1.0 | unchanged |
| `@house-rules/rules` | 0.18.0 | unchanged |
| `@house-rules/migrations` | 0.3.0 | unchanged |
| `@house-rules/node-host` | 0.2.0 | new public API: `staticFiles` serves a built single-page app from the API's own service; 0.1.0 is on npm |

The three new packages peer on exact domain 0.1.0, application 0.2.0 and Effect 4.0.3. Identity and party ship their SQL migrations; an app lists each in `migrations.json`.

Before a later approved publish, confirm the `NPM_TOKEN` owner can create `@house-rules/auth-jwt`, `@house-rules/identity` and `@house-rules/party` in the scope. A token limited to existing packages will not cover these first releases. The same OIDC, provenance and release-age notes as the kits release apply. Do not manually publish or create a trigger tag to merge this work.

### If tagging failed

A workflow rerun may publish nothing, leaving an empty summary. Normal tagging then does nothing. A missing summary is an error: the tagging step fails the job and prints a recovery hint. Do not bump versions or republish to fix tags.

1. [ ] In a clean checkout, fetch tags and check out the exact release commit from the failed run, not today's `main`. Confirm `git rev-parse HEAD` matches that run. Use the fixed recovery script from a newer checkout if the release commit lacks it.
2. [ ] Run `node /path/to/fixed/scripts/tag-published.mjs --recover --dry-run` from that release checkout. It reads the 19 known public workspace versions, plus the retired `capability` package, which only recovery reads, queries npm for each exact version and fetches `dist.attestations.url`. It decodes the DSSE payload's SLSA provenance and reads `predicate.buildDefinition.resolvedDependencies[].digest.gitCommit`. The workflow repository and source URI must name `JakubSzwajka/house-rules`; the source commit must equal HEAD for a package to qualify. `gitHead` is not used. The dry run prints matching packages and commits, checks local tag conflicts and makes no Git writes.
3. [ ] With approval to push the release tags and an authenticated `origin`, rerun without `--dry-run`. Recovery pushes all matching tags atomically, including local tags left by a failed push. Check the tags on `origin`. It never moves a tag at another commit and also recovers packages that reached npm before a partial publish failure.

Unpublished versions and versions sourced from another commit are skipped. Missing or unreadable attestations, a foreign repository, malformed provenance and registry failures other than 404 stop recovery before any tag is created. Recovery reads provenance served by npm; it does not verify bundle signatures itself.

Historical checkouts may predate a known package. Recovery skips only an absent package manifest (ENOENT); an existing private manifest, invalid JSON or version, or any other read failure still stops it. This lets the current script recover release commits from before comments, domain, application, auth-jwt, identity or party existed, and commits that still have `packages/capability`. A publish summary that names `@house-rules/capability` still fails: only recovery accepts the retired name.

Recovery does not publish anything. A personal-token push can trigger the publish workflow; use `GITHUB_TOKEN` in CI if that must be avoided.

### Backfill the two missing release sets

Use Node 24.21.0 and the fixed script while each detached worktree supplies its historical package versions. From the checkout containing this fix:

```sh
recovery="$(pwd)/scripts/tag-published.mjs"
git worktree add --detach /tmp/hr-recover-dc422cd dc422cd
git worktree add --detach /tmp/hr-recover-f844b82 f844b82
(cd /tmp/hr-recover-dc422cd && mise exec node@24.21.0 -- node "$recovery" --recover --dry-run)
(cd /tmp/hr-recover-f844b82 && mise exec node@24.21.0 -- node "$recovery" --recover --dry-run)
```

At `dc422cd`, expect rules `0.16.0`, capability `0.13.1`, migrations `0.2.1` and call-audit `0.2.1`. At `f844b82`, expect rules `0.16.1`, capability `0.14.0` and call-audit `0.3.0`; migrations `0.2.1` is skipped because its provenance names `dc422cd`.

Only after approval to create and push these tags, run:

```sh
(cd /tmp/hr-recover-dc422cd && mise exec node@24.21.0 -- node "$recovery" --recover)
(cd /tmp/hr-recover-f844b82 && mise exec node@24.21.0 -- node "$recovery" --recover)
git worktree remove /tmp/hr-recover-dc422cd
git worktree remove /tmp/hr-recover-f844b82
```

If you only run the preview, remove the worktrees without running either write command.

## The flow

```text
Create release (dispatch on main)
  │
  ├─ build-and-tag            skipped when redeploy is set
  │    next vX.Y.Z from the newest v*.*.* tag (cli-v* tags are ignored)
  │    dry_run? ── yes ──> print version + commit subjects, stop
  │    build + push ONE image:
  │      ghcr.io/<owner>/<repo>:prod-sha-<12>   (immutable, what deploy uses)
  │      ghcr.io/<owner>/<repo>:vX.Y.Z
  │      ghcr.io/<owner>/<repo>:latest
  │    git tag vX.Y.Z + push, gh release create --generate-notes
  │
  └─ deploy                   after a good build, or alone with redeploy
       vX.Y.Z ─> commit ─> prod-sha-<12>
       Dokploy application.update (image) ─> application.deploy
         title "vX.Y.Z (prod-sha-<12>)"
       poll APP_URL/api/health until 200 and commit == <12>  (10 min)
       notify Discord (always, never fails the job)
```

The build runs before the tag, so a failed build never leaves a tag or a release behind. The image name is the repository name in lowercase, because GHCR rejects uppercase.

Runs share one concurrency group per repo, `<repo>-release`. A second run waits and is never cancelled.

## What a project needs

1. [ ] A `Dockerfile` that bakes in the commit:

   ```dockerfile
   ARG APP_COMMIT=unknown
   ENV APP_COMMIT=$APP_COMMIT
   ```

2. [ ] A health endpoint at `/api/health`. It returns HTTP 200 with this body, where `commit` is the first 12 characters of `APP_COMMIT`:

   ```json
   {"status":"ok","commit":"0123456789ab"}
   ```

   The old container keeps answering 200 until the new one is healthy. That is why the deploy waits for the new `commit`, not for any 200.

3. [ ] Repo secrets: `DOKPLOY_API_KEY` and `DISCORD_DEPLOY_WEBHOOK`. The webhook is a plain Discord channel webhook URL. If it is empty, the notify step does nothing.
4. [ ] Repo variables: `DOKPLOY_BASE_URL`, `DOKPLOY_APPLICATION_ID`, and `APP_URL`.
5. [ ] A Dokploy application with a Docker image source, able to pull from GHCR.

The steps that switch a Dokploy app over to this workflow are not in this repo. They live in the operator's `release` skill.

## Cut a release

1. [ ] Preview it: `gh workflow run "Create release" --ref main -f bump=patch -f dry_run=true`. The run log and summary show the next version and the commit subjects since the last tag. Nothing is built, tagged, or deployed.
2. [ ] Ship it: `gh workflow run "Create release" --ref main -f bump=patch`. Use `minor` or `major` as needed.

The Git tag is the version. The `version` fields in `package.json` mean nothing here. Release notes come from GitHub (`--generate-notes`).

The Discord line reads `✅ <repo> prod deploy succeeded — vX.Y.Z (<12>) — <run url>`, or `❌ <repo> prod deploy failed — …` for any other outcome.

## Roll back

```sh
gh workflow run "Create release" --ref main -f redeploy=v1.2.3
```

`redeploy` skips the build and the tag. It points Dokploy at that release's `prod-sha-<12>` image and runs the same health wait and notify. Nothing is rebuilt. The same command redeploys the current version.

A container rollback is not a database rollback. If the release ran a migration, the old image meets the new schema.

## What may differ per project

These sit at the top of the workflow file, or on the job:

- `DOCKERFILE` and `BUILD_CONTEXT`: the Dockerfile path and the build context.
- `RELEASE_MARK_LATEST`: `"true"` or `"false"`, passed to `gh release create --latest`. Use `"false"` when another release line in the repo, such as `cli-v*`, should keep the Latest badge.
- `HEALTH_PATH`: the health path, if the project changes it and keeps the body contract.
- `runs-on`: the runner labels.

Keep the rest the same in every copy: build before tag, the immutable `prod-sha-<12>` tag, the Dokploy deploy title, the Discord line format, and actions pinned to full SHAs. `fx release verify` checks the title, the image tag, and the Discord line. The copies are kept in step by hand, so port a fix here as well as to the project.
