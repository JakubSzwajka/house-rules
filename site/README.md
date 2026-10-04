# @house-rules/site

The House Rules docs site, for people and agents. It is built with [Astro](https://astro.build) and [Starlight](https://starlight.astro.build), and served at `https://stack.kubaszwajka.com`.

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

The theme is an assembly manual. Light mode is a white instruction sheet: black line, and safety yellow as the one accent. Dark mode is the same sheet inverted: true black paper, white line, the same yellow. No paper in either mode has a hue. A thin construction layer sits on top: hazard tape under the header and above each section on the home page, and a grid around the home figure in light mode only. No grid sits behind text.

Type is IBM Plex: Plex Sans for body text, Plex Sans Condensed Bold for headings, Plex Mono for code. Prose stops at about 70 characters a line (`--hr-measure`). An inline code chip never breaks in the middle, link underlines are 1px, and the first column of a table, usually a rule name, is set in mono at body weight.

Docs pages stay documentation first: Starlight's sidebar and contents list, dense text. Graphics live in three places only:

1. The home page: the cover with the figure holding a part with a loose bolt, and the three numbered assembly steps.
2. The 404 page: the same figure.
3. A small kit for the docs pages: yellow step badges on the numbered checkbox lists of procedure pages (the start guide, the Effect guide, and the skill pages), the parts list box on each generated rule page, and the yellow title band with a warning triangle on caution asides and on the fence page's safety guard notice.

The figure is a toggle button (`aria-pressed`, so click, Enter and Space all work). Until pressed, the bolt wobbles, a wrench bobs above it and a "tighten it" cue points at the wrench. Pressing swings the wrench, seats the bolt, stops the wobble and makes him smile, and the caption becomes "Loose parts wobble. Pin them." Under `prefers-reduced-motion` nothing moves: the bolt sits crooked and the cue stays, and pressing switches straight to the tightened state.

| File | Owns |
| --- | --- |
| `src/styles/fonts.css` | the self-hosted faces from `public/fonts/` (see `FONTS.txt` and the `LICENSE-*.txt` files there): IBM Plex Sans, IBM Plex Sans Condensed and IBM Plex Mono |
| `src/styles/theme.css` | colours, fonts, measure, radius, line width and the hazard tape as `--hr-*` tokens named by role, mapped onto Starlight's `--sl-color-*` |
| `src/styles/chrome.css` | header, sidebar, contents list, pager, buttons |
| `src/styles/content.css` | page titles, prose, tables, step badges, asides, code frames, and the home page tape |
| `src/components/manual-hero.astro` | the home page cover and assembly steps (Starlight `Hero`) |
| `src/components/manual-figure.astro` | the figure with the loose bolt, a toggle button, and the grid around it on the home page; home and 404 only |
| `src/components/page-title.astro` | the page title (Starlight `PageTitle`), plus the parts list on rule pages and the safety guard on the fence page |
| `src/components/parts-list.astro` | the parts list box |
| `src/components/warning-triangle.astro` | the warning triangle |
| `src/pages/404.astro` | the 404 page, through `StarlightPage`; `disable404Route` turns off Starlight's own |
| `src/assets/logo.svg` | the header logo |

`src/styles/theme.css` is the only stylesheet with raw colours. The tokens name a role, not a colour: `--hr-paper`, `--hr-ink`, `--hr-line`, `--hr-accent`, `--hr-caution`, `--hr-refuse`, `--hr-ok`, and so on. A palette swap is a change to that file. The logo SVG carries its own two colours, because an `<img>` cannot read CSS variables.

The parts list is the one metadata block on a rule page. `astro.config.ts` reads `packages/rules/README.md` through `scripts/rule-rows.ts`, plus each generated page's own Field | Value rows, and serves them to components as the virtual module `virtual:house-rules/parts`. `content.css` hides the page's own table, so the same facts show once. The generated rule pages stay untouched.

Step badges are opt-in by page. The same module lists the procedure pages (`PROCEDURE_ROUTES` and `PROCEDURE_ROUTE_PREFIXES` in `astro.config.ts`), and `page-title.astro` marks them with `data-hr-procedure`. A numbered checkbox list elsewhere, such as the fence's blocked commands, stays plain.

Grid lines are opaque, not alpha, so where lines cross the colour stays one line colour. The words inside the drawing carry a paper-coloured halo, so no line runs through a letter.

`scripts/accessible-blocks.ts` adds two build-time fixes to rendered Markdown: each task-list checkbox gets an `aria-label` from its item, and each code block can take keyboard focus, since a wide one scrolls sideways.

## Source links

Pages and generated rule and skill pages link to files in the repository. Committed pages point at `main`. The build retargets, in the HTML it writes and in the llms files, every link to `https://github.com/JakubSzwajka/house-rules/{blob,tree}/main/...` at the ref in `SITE_SOURCE_REF`, and `llms.txt` names that ref. Without the variable the ref is `main`. Use it while a page or skill exists only on a branch:

```sh
SITE_SOURCE_REF=docs/site pnpm --filter @house-rules/site build
docker build -f site/Dockerfile --build-arg SITE_SOURCE_REF=docs/site -t house-rules-site .
```

The value must be a plain branch, tag, or commit name. The committed generated pages never change with it.

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
| `.dependency-cruiser.cjs` | splits `no-unresolved-imports`: importers under `site/` may import `astro:` modules, every other importer is checked as before | Astro's virtual modules, such as `astro:content`, exist on no disk |

`pnpm-workspace.yaml` sets `esbuild: false` in `allowBuilds`. Astro's esbuild ships its binary as an optional dependency, and the build works without its install script.
