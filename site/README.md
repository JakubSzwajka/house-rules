# @house-rules/site

The house-rules docs site, for people and agents. It is built with [Astro](https://astro.build) and [Starlight](https://starlight.astro.build), and served at `https://stack.kubaszwajka.com`.

## Where pages come from

```text
site/src/content/docs/
├── index.md       home (splash template)
├── start/         hand-written
├── guides/        hand-written
├── reference/     hand-written
├── rules/         generated from packages/rules (README rules table, rule meta, docs/)
└── skills/        generated from skills/*/SKILL.md
```

`scripts/generate.ts` writes `rules/` and `skills/`. Never edit a file there: change the source, then run `pnpm --filter @house-rules/site generate` and commit the result. The site's test fails when a generated page is stale. The skill `skills/write-a-docs-page/SKILL.md` covers adding a page.

Pages link to each other, and to repo files, by relative path to the `.md` file, such as `../guides/the-fence.md` or `../../../../../AGENTS.md`. ESLint's `no-broken-relative-links` checks those paths against git. At build time `scripts/link-plugin.ts` turns a page link into its route and a repo link into a GitHub URL.

## Agent-readable output

After `astro build`, `scripts/llms.ts` writes into `dist/`:

- `llms.txt`, an index of every page;
- `llms-full.txt`, every page in one file;
- `<route>.md`, one Markdown copy per page, such as `rules/eslint/comment-discipline.md`.

## Commands

```sh
pnpm --filter @house-rules/site generate   # rewrite the generated pages
pnpm --filter @house-rules/site dev        # generate, then serve with live reload
pnpm --filter @house-rules/site build      # generate, build to dist/, write the llms files
pnpm --filter @house-rules/site typecheck  # tsc over scripts/ and astro.config.ts
pnpm --filter @house-rules/site test       # generated pages fresh, one per rule and skill, llms files
```

Astro telemetry is off: every script sets `ASTRO_TELEMETRY_DISABLED=1`.

## Look

`src/styles/theme.css` is the one theme layer. It sets Starlight's custom properties from a few `--hr-*` values. A visual direction replaces that file and the home page frontmatter, nothing else.

## Docker

```sh
docker build -f site/Dockerfile -t house-rules-site .
docker run --rm -p 8080:80 house-rules-site
curl -i localhost:8080/healthz
```

The build stage installs the workspace from the lockfile without install scripts and runs the site build. The serve stage is Caddy, pinned by digest, serving `dist/` on port 80. `/healthz` answers 200.

## Why the config differs from apps and packages

The site is not an app or a package, so the layout rules do not fit it, and none of its paths match them. Every other check runs on it. Four things are scoped to it:

| Where | What | Why |
| --- | --- | --- |
| `site/tsconfig.json` | extends `@house-rules/rules/tsconfig/strict.json`, not the Effect preset | the generator is plain Node; Effect diagnostics such as `nodeBuiltinImport` fail every line of it |
| `biome.json` | skips `site/dist` and `site/.astro` | build output and Astro's generated types |
| `eslint.config.mjs` | ignores `site/.astro/` | Astro's generated types (`dist/` was already ignored) |
| `.dependency-cruiser.cjs` | excludes `^astro:` | Astro's virtual modules, such as `astro:content`, exist on no disk |

`pnpm-workspace.yaml` sets `esbuild: false` in `allowBuilds`. Astro's esbuild ships its binary as an optional dependency, and the build works without its install script.
