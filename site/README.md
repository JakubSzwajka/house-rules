# @house-rules/site

The House Rules docs site, for people deciding on the template and starting a repo from it. Agents read `AGENTS.md` in their own repo instead. It is built with [Astro](https://astro.build) and [Starlight](https://starlight.astro.build), and served at `https://stack.kubaszwajka.com`.

## Where pages come from

```text
site/src/content/docs/
├── index.md         home (splash template)                       /
├── start/index.md   hand-written: what it is, make the repo,     /start/
│                    what happens on commit
└── rules/index.md   generated: one table row per rule            /rules/
```

`scripts/generate.ts` writes `rules/index.md` from the rules table in `packages/rules/README.md`, through `scripts/rule-rows.ts` and `scripts/rules-table.ts`. Never edit it: change the source, then run `pnpm --filter @house-rules/site generate` and commit the result. The site's test fails when the page is stale.

Each row has an anchor equal to its rule id, such as `/rules/#comment-discipline` or `/rules/#noReExportAll`. An id that is not a plain name is slugified: `shadcn/*` is `#shadcn`, and `Exact pins` is `#exact-pins`. Error messages link to these anchors, so never rename one. The "What it refuses" cell is the first sentence of an ESLint rule's `meta.docs.description`, or the row's Catches cell for every other rule and for the `shadcn/*` row.

The start page links to repo files by relative path, such as `../../../../../lefthook.yml`, and to the rules page as `../rules/index.md`. ESLint's `no-broken-relative-links` checks those paths against git. At build time `scripts/link-plugin.ts` turns a page link into its route and a repo link into a GitHub URL.

Old routes, such as `/guides/the-fence/` or `/rules/eslint/comment-discipline/`, answer with a 301 from the `redir` lines in `Caddyfile`: a rule page goes to its row, and every other page to `/start/` or `/rules/`. `scripts/tests/redirects.test.ts` checks them. The dev server does not serve them.

## Agent-readable output

After `astro build`, `scripts/llms.ts` writes `dist/llms.txt`: what House Rules is, the two page URLs, the line that sends agents to `AGENTS.md` in their own repo, and the GitHub URL. The dev server serves the same file.

## Commands

```sh
pnpm --filter @house-rules/site generate   # rewrite rules/index.md
pnpm --filter @house-rules/site dev        # generate, then serve with live reload
pnpm --filter @house-rules/site build      # generate, build to dist/, write llms.txt
pnpm --filter @house-rules/site typecheck  # tsc over scripts/ and astro.config.ts
pnpm --filter @house-rules/site test       # rules page fresh, anchors, redirects, llms.txt, home
```

Astro telemetry is off: every script sets `ASTRO_TELEMETRY_DISABLED=1`.

## Look

The theme is an assembly manual. Light mode is a white instruction sheet: black line, and safety yellow as the one accent. Dark mode is the same sheet inverted: true black paper, white line, the same yellow. No paper in either mode has a hue. A thin construction layer sits on top: hazard tape under the header, and on the home page above the stat strip and in the refusal demo, plus a grid around the home figure. No grid sits behind text.

Type is IBM Plex: Plex Sans for body text, Plex Sans Condensed Bold for headings, Plex Mono for code. Prose stops at about 70 characters a line (`--hr-measure`). An inline code chip never breaks in the middle, link underlines are 1px, and the first column of a table, usually a rule name, is set in mono at body weight.

Docs pages stay documentation first: Starlight's sidebar with its two links, the contents list, dense text. Graphics live in two places only:

1. The home page, top to bottom:
   - the hero: headline, tagline, one line on what the template is, and the figure;
   - the refusal demo: three tabs ("Skip the hooks", "Read another package's table", "Hand-roll an MCP tool"), each playing one case the checks refuse. It types the agent's command, drops hazard tape with STOPPED, and prints the real refusal quoted from source (`scripts/tests/home.test.ts` checks each against its file);
   - the start block: the `gh repo create` command with a copy button, the install-and-check step, and two buttons;
   - the stat strip under a band of tape: the rule count, the tool count, and one hook with its line `pre-commit: pnpm check + pnpm test`;
   - a nav line: Start, Rules, GitHub;
   - the footer: a line pointing agents at `/llms.txt`, and the author credit.
2. The 404 page: the same figure, with links to the home page, the start page and the rules page.

A link to `/rules/#<id>` marks that rule's row in the selection yellow. Below 50rem the rules table stacks each row (name, sentence, then tool and docs link) instead of scrolling sideways. Caution asides keep a yellow title band with Starlight's warning icon.

The figure is a toggle button (`aria-pressed`, so click, Enter and Space all work). Until pressed, the bolt wobbles, a wrench bobs above it and a "tighten it" cue points at the wrench. Pressing swings the wrench, seats the bolt, stops the wobble and makes him smile, and the caption becomes "Tight. Press again to loosen it." Under `prefers-reduced-motion` nothing moves: the bolt sits crooked and the cue stays, and pressing switches straight to the tightened state.

The refusal demo drives the figure through the `hr-figure` event on `document` (`detail.tight`): it loosens the bolt when a case starts and tightens it when the refusal prints. The home page plays the first case once, when the demo scrolls into view. Without JS all three cases show stacked at their end state. Under `prefers-reduced-motion`, including when the setting changes while the page is open, every case shows its end state at once. The tabs are a roving-tabindex tablist (arrows, Home and End); `aria-orientation` is `vertical` when they stack on a narrow screen.

| File | Owns |
| --- | --- |
| `src/styles/fonts.css` | the self-hosted faces from `public/fonts/` (see `FONTS.txt` and the `LICENSE-*.txt` files there): IBM Plex Sans, IBM Plex Sans Condensed and IBM Plex Mono |
| `src/styles/theme.css` | colours, fonts, measure, radius, line width and the hazard tape as `--hr-*` tokens named by role, mapped onto Starlight's `--sl-color-*` |
| `src/styles/chrome.css` | header, sidebar, contents list, pager, buttons |
| `src/styles/content.css` | page titles, prose, links, inline code chips, tables, the marked rule row and its stacked narrow-screen layout, and task-list checkboxes |
| `src/styles/blocks.css` | asides, code frames and the home page tape, loaded straight after `content.css` |
| `src/components/manual-hero.astro` | the home page hero, start block, stat strip and nav line, with the demo and figure placed in it (Starlight `Hero`) |
| `src/components/refusal-demo.astro` | the three-tab refusal demo; home only |
| `src/components/manual-footer.astro` | the home page footer line for agents and the credit; other pages keep Starlight's footer |
| `src/components/manual-figure.astro` | the figure with the loose bolt, a toggle button that the demo also drives, and the grid around it on the home page; home and 404 only |
| `src/components/page-title.astro` | the page title (Starlight `PageTitle`) |
| `src/pages/404.astro` | the 404 page, through `StarlightPage`; `disable404Route` turns off Starlight's own |
| `src/assets/logo.svg` | the header logo |
| `src/assets/og-image.svg` | the source of `public/og-image.png`, the share card |
| `src/assets/apple-touch-icon.svg` | the source of `public/apple-touch-icon.png` |
| `public/favicon.svg` | the favicon; a copy of `logo.svg` |

`src/styles/theme.css` is the only stylesheet with raw colours. The tokens name a role, not a colour: `--hr-paper`, `--hr-ink`, `--hr-line`, `--hr-accent`, `--hr-caution`, `--hr-refuse`, `--hr-ok`, and so on. A palette swap is a change to that file. The logo SVG carries its own two colours, because an `<img>` cannot read CSS variables.

The home page's counts come from `virtual:house-rules/parts`, a module `astro.config.ts` builds from `scripts/rule-rows.ts`, because a component bundled by Vite cannot find the repo root.

Grid lines are opaque, not alpha, so where lines cross the colour stays one line colour. The words inside the drawing carry a paper-coloured halo, so no line runs through a letter.

`scripts/accessible-blocks.ts` adds two build-time fixes to rendered Markdown: each task-list checkbox gets an `aria-label` from its item, and each code block can take keyboard focus, since a wide one scrolls sideways.

## Share card and icons

Every page carries `og:image` and `twitter:image` (the absolute URL `https://stack.kubaszwajka.com/og-image.png`, 1200x630) and `<link rel="apple-touch-icon">`, set in the `head` array of `astro.config.ts`. Starlight links `/favicon.svg` on its own.

The PNGs are committed; regenerate them after a change to their SVG source:

```sh
# apple-touch-icon (no fonts in it)
rsvg-convert -w 180 -h 180 site/src/assets/apple-touch-icon.svg -o site/public/apple-touch-icon.png
# og image: needs a browser, because the SVG loads the woff2 fonts from public/fonts
agent-browser set viewport 1200 630
agent-browser open file://$PWD/site/src/assets/og-image.svg
agent-browser screenshot site/public/og-image.png
```

`scripts/tests/share-assets.test.ts` checks that the files exist and have the right pixel size.

## Source links

The start page and the rules page link to files in the repository. Committed pages point at `main`. The build retargets, in the HTML it writes, every link to `https://github.com/JakubSzwajka/house-rules/{blob,tree}/main/...` at the ref in `SITE_SOURCE_REF`. Without the variable the ref is `main`. Use it while a rule doc exists only on a branch:

```sh
SITE_SOURCE_REF=docs/site pnpm --filter @house-rules/site build
docker build -f site/Dockerfile --build-arg SITE_SOURCE_REF=docs/site -t house-rules-site .
```

The value must be a plain branch, tag, or commit name. The committed rules page never changes with it.

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
