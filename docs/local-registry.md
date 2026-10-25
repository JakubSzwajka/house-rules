# Local framework registry

Use Verdaccio to try framework changes in a consumer without releasing to npm. Keep this setup on a working branch. Nothing here changes the real release flow in `.github/workflows/publish.yml`.

## Start and set up once

From the framework checkout:

```sh
docker compose -f scripts/local-registry/compose.yaml up -d
curl --fail http://127.0.0.1:4873/-/ping
```

The image is pinned to `verdaccio/verdaccio:7.0.0@sha256:7bfad61f0dd08919d5c2dee6fcc9a9de969ecd840836c5859a37b1b144ab8d89`. Only `127.0.0.1:4873` is exposed. Packages and the user file live in Docker volume `house-rules-local-registry_storage`, not in Git.

Create the single dev-only account once per storage volume:

```sh
node --input-type=module <<'NODE'
const response = await fetch('http://127.0.0.1:4873/-/user/org.couchdb.user:local', {
  method: 'PUT',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ name: 'local', password: 'house-rules-local', email: 'local@example.invalid', type: 'user' }),
});
if (!response.ok) throw new Error(`Local account setup failed: HTTP ${response.status}`);
console.log('Local account created. No login or token file is needed.');
NODE
```

`local` / `house-rules-local` is a public development credential. The publisher exchanges it for a local token and writes that token only to a temporary npm config. Do not reuse it elsewhere, expose this registry to a network, or put real npm credentials in its config. Downloads need no login. Other package scopes proxy npmjs; `@house-rules/*` never falls back to npmjs. Publishing other scopes is disabled.

## Publish framework changes

Install with the pinned pnpm and build prerequisites as usual. Then choose one command:

```sh
pnpm run local-publish
pnpm run local-publish work-items comments
pnpm run local-publish --since origin/main
# Explicitly allow uncommitted development changes:
pnpm run local-publish --allow-dirty
```

For board development, use the default: it publishes all 20 public packages with one shared timestamp so the consumer can move every framework pin together. Named packages are useful for quick single-package checks. Named packages and `--since` also include their internal dependencies so their packed pins resolve. The publisher orders dependencies before dependents, so a failed batch cannot publish a dependent before its local pins exist. `--since` compares the given commit with the working tree; a change outside `packages/` selects all packages conservatively. Untracked files require `--allow-dirty` but are not part of Git's changed-since comparison. Use a named package or publish all when adding untracked code.

Each run builds the TypeScript packages, packs with pnpm, then edits only temporary extracted manifests. Versions look like `0.1.0-local.20261025123456789`, with one UTC millisecond timestamp per run. Every internal dependency field gets an exact matching local version. Source `package.json` files stay unchanged, including on failure. The script neither commits nor creates Git tags. npm's `local` dist-tag points at the last local publication. Verdaccio can also initialize `latest` on a package's first publication, so consumers must use exact versions rather than either tag.

Only HTTP loopback registry origins are accepted by `--registry`. The default is `http://127.0.0.1:4873`. Do not run simultaneous publishers: a failed run can leave a partially published batch. It prints the exact successful versions even if a later publication fails. Fix the cause and publish a fresh batch.

## Point a consumer at local packages

In a working branch of the consumer, such as board, add this scope-only line to its `.npmrc`. Leave its default registry unchanged:

```ini
@house-rules:registry=http://127.0.0.1:4873
```

In the consumer's `pnpm-workspace.yaml`, temporarily exclude only this scope from the release-age delay. Keep any other existing settings:

```yaml
minimumReleaseAgeExclude:
  - '@house-rules/*'
```

Copy the publisher's `overrides:` block into that same file to pin transitive framework dependencies. Replace any existing framework overrides rather than adding duplicate keys. Set direct dependencies to exact published versions, too:

```sh
pnpm add --save-exact @house-rules/work-items@0.1.0-local.20261025123456789
```

Use the actual version printed by your run, not this example. Do not save `@local`, ranges, or workspace links. Local versions only exist on your machine; CI cannot fetch them. For a quick smoke test, use a throwaway folder under `/tmp` with its own `package.json`, `.npmrc` and `pnpm-workspace.yaml` so no consumer checkout is changed.

## Switch back before merging a consumer to main

- Replace every direct `-local` dependency with an exact real npm version that contains the needed changes. Wait for the framework's normal release workflow if needed.
- Remove the temporary framework `overrides`, the scope registry line, and the `@house-rules/*` release-age exclusion. Preserve unrelated settings.
- Reinstall from npmjs. Check `package.json`, workspace config and the lockfile for local versions and `127.0.0.1:4873` URLs.
- Run the consumer's full checks and tests. Merge only with green CI using real npm packages.

## Stop

```sh
docker compose -f scripts/local-registry/compose.yaml down
```

This stops only this Compose project and keeps its volume for next time. Do not add `--volumes` unless you intend to discard the local packages and account. The end-to-end setup leaves Verdaccio running for further development.
