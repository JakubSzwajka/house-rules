# @house-rules/rules

This package, in `packages/rules` of the house-rules repository, is the one installable home of the operator's house rules and house configs. It is a private GitHub package, installed by Git subpath, with eight ESLint rules, a preset for the third-party `@shadcn/lint` plugin, one Dependency Cruiser preset, two TypeScript presets, one Biome preset and two bins. It extracts Hosti's comment-discipline rule without changing the rule's semantics, adds a Markdown rule that reports relative links to paths git does not track, adds four design-token rules for CSS and JS/TS, ships drunk-cat-stack's monorepo layout rules as a reusable Dependency Cruiser config, ships drunk-cat-stack's tsconfig, Biome config and exact-pins script, and adds two capability rules and a module-owned SQL checker for the stack's capability and module shape.

## Split with consumers

This package owns house rules and house configs. A consumer repository keeps only:

- project values, such as the npm scope, token files and path excludes;
- files no tool can inherit: `turbo.json`, `pnpm-workspace.yaml`, the env schema, CI, and agent-harness hooks (the `--no-verify` fence and lefthook stay in the consumer on purpose, so the fence never depends on `node_modules`);
- prose;
- tests that check its own wiring.

## Vocabulary

- **Rule**: one of the eight lint rules in this package: `comment-discipline`, `no-broken-relative-links`, `design-no-raw-color`, `design-no-raw-color-literal`, `design-no-unknown-token`, `design-scale-value`, `use-case-is-capability`, or `no-hand-rolled-surface`.
- **Preset**: a flat-config array a consumer spreads into `eslint.config.mjs`. There are five:
  - `recommended`, exported as `plugin.configs.recommended` from the package root. It runs `comment-discipline` on JS, JSX, MJS, CJS, TS, TSX, MTS, and CTS.
  - `capability`, exported as `plugin.configs.capability` from the package root. It runs `no-hand-rolled-surface` on the same JS and TS files as `recommended`, and `use-case-is-capability` on TS, TSX, MTS, and CTS, with the same parser setup.
  - `markdown`, the default export of the `@house-rules/rules/markdown` subpath. It runs `no-broken-relative-links` on `**/*.md` through the `@eslint/markdown` GFM language.
  - `design`, the preset returned by the `design(options)` factory, the default and named export of the `@house-rules/rules/design` subpath. It returns a CSS block on the `@eslint/css` `css/css` language running the three CSS design rules, and a source block running `design-no-raw-color-literal` with the same parser setup as `recommended`.
  - `shadcn`, the preset returned by the `shadcn(options)` factory, the default and named export of the `@house-rules/rules/shadcn` subpath. It returns an app block running the six `@shadcn/lint` rules on JSX and TSX, with the same parser setup as `recommended`, and a **component-folder** block that turns off `no-restyle`, `no-arbitrary-values` and `require-static-classes`. Its rules belong to `@shadcn/lint` and are not counted among the eight.
- **Layout preset**: the Dependency Cruiser config returned by the `layout(options)` factory, the named export of the `@house-rules/rules/dependency-cruiser` subpath. It is not an ESLint preset and not one of the five presets above. It returns a whole Dependency Cruiser config, `forbidden` plus `options`, holding 17 **layout rules**. Layout rules are Dependency Cruiser rules, not ESLint rules, and are not counted among the eight.
- **Config preset**: a JSON file another tool extends by package specifier. There are three: `tsconfig/strict.json`, `tsconfig/effect.json` (extends `strict.json`, adds the `@effect/language-service` plugin block), and `biome/preset.json`, exported as `@house-rules/rules/biome`. They are not ESLint presets.
- **Pins bin**: `house-rules-pins`, `bin/pins.mjs`. It fails when a dependency in the root or a workspace `package.json` is not an exact version, `workspace:<exact>`, or a Git spec pinned to a full commit.
- **Migrations bin**: `house-rules-migrations`, `bin/migrations.mjs`. It fails when one workspace package's migrations or SQL strings reach another package's tables, when a `.sql` file sits outside a `<package>/migrations/` folder and outside a package's `fixtures/` or `tests/` folder, when code outside an adapter package opens a raw transaction (`withTransaction` or a `begin` string), when a module's own code opens a unit of work, or when the **module list** (`migrations.json`) leaves out a module that has migrations: a workspace package with a `migrations/` folder, or a dependency whose `package.json` declares `houseRules.migrations`.
- **Owning package**: the workspace package whose migration creates a table.
- **Consumer**: a repository that installs this package from GitHub and uses one or more of its presets or its bin.
- **Exception**: one closed, syntax-owned directive or legal header accepted by `comment-discipline`.
- **Relative link**: a Markdown link, image, or link reference definition whose target has no URI scheme, is not a pure anchor, is not protocol-relative, and contains no `{` placeholder.
- **Tracked path**: a file listed by `git ls-files` for the repository that holds the linted file, or a parent directory of one. Matching is exact and case-sensitive.
- **Root**: a subdirectory named in the `roots` option. Links from files under a root resolve `/` against it and may not leave it.
- **Token file**: a CSS file named in `tokenFiles`, resolved from ESLint's working directory. Every custom property it defines is a **token**. Custom-property definitions inside a token file are exempt from `design-no-raw-color`.
- **Raw colour**: a hex colour, a colour function (`rgb()` through `color()`), or a named colour written out instead of taken from a token. The JS/TS rule checks hex and colour functions only.
- **Component folder**: a folder of design-system components, such as `components/ui`, named in the `components` option of `shadcn()`. Components own their look there, so the three restyle rules are off.
- **Scale**: the `allowed` values and `requireVar` prefix of one `design-scale-value` entry.

## Contract

- Package name and version are `@house-rules/rules@0.8.0` until an intentional release decision changes them. `package.json` and `plugin.meta.version` carry the same version, and `plugin.meta.name` is the package name.
- The package is ESM, runs checked-in `.mjs` source directly (plus the one `.cjs` layout preset), and supports Node `>=24.21.0`, matching every consumer (all pin Node 24.21.0 in `.nvmrc` and `engines: >=24.21.0`). CI reads `.nvmrc`.
- `private: true` stays set. Do not npm-publish.
- The plugin key is `house-rules`.
- `@typescript-eslint/parser` is a runtime dependency so consumers install no parser separately.
- ESLint is a peer dependency and a development dependency for this repository.
- `@eslint/markdown` is an optional peer dependency and a development dependency. Only `src/markdown.mjs` imports it. The package root must never load it, so `recommended` consumers install nothing new.
- `@eslint/css` is an optional peer dependency and a development dependency. Only `src/design.mjs` imports it. The package root registers the design rules but must never load it. Token files are read by a small custom-property scanner in `src/design-tokens.mjs`, not by the CSS parser, for that reason.
- `@shadcn/lint` is an optional peer dependency (`^0.2.0`) and an exact development dependency. Only `src/shadcn.mjs` imports it. The package root and `src/design.mjs` must never load it. The `shadcn()` defaults follow the plugin's `docs/adoption.md` at tag `@shadcn/lint@0.2.0`; the plugin ships no preset of its own. `tailwindcss` is not a development dependency, so the fixture test runs `no-unknown-classes` on the plugin's bundled grammar.
- `dependency-cruiser` is an optional peer dependency and an exact development dependency. Only the tests import it. `src/dependency-cruiser.cjs` is the one CommonJS file in `src/`, so a `.dependency-cruiser.cjs` config can `require` it. It requires nothing, so it never loads ESLint, `@eslint/css`, or `@eslint/markdown`.
- `tests/fixtures/dependency-cruiser/layout-hosti.snapshot.json` is a snapshot of `layout({ scope: "@hosti/" })`, and a test compares them. Refresh it only for an intentional rule change. Rules that concern a file's location (`tests-live-in-tests-dir`, `app-code-in-layers`, `no-ownerless-files`) are module rules with `numberOfDependentsLessThan: 100`, because a dependency rule cannot see a file whose only imports are excluded `node_modules` packages. drunk-cat-stack switches to `layout()` in the next phase.
- `tsconfig/strict.json` plus `tsconfig/effect.json` equal drunk-cat-stack's `tsconfig.base.json`, and `biome/preset.json` equals its `biome.json` without `files`. Copies live in `tests/fixtures/presets/`, and tests compare them. Biome replaces an extended `files.includes` instead of merging it, so `files` belongs to the consumer.
- The config presets are tested against TypeScript 7.0.2, `@effect/tsgo` 0.45.0 and Biome 2.5.14. `typescript` 7.0.2 is an exact development dependency under the alias `typescript-7`, because `@typescript-eslint/parser` and Dependency Cruiser need the TypeScript 6 that stays at `node_modules/typescript`. `@biomejs/biome` 2.5.14 is an exact development dependency. Neither is a peer: consumers bring their own.
- The pins bin is drunk-cat-stack's `scripts/check-exact-pins.mjs` with the same behavior, messages and exit codes. Its workspace mode uses `fs.globSync`, with no fallback for older Node.
- Token files are parsed once per process and cached by absolute real path, modification time, and size.
- Consumer path ignores do not belong in the preset.
- The `comment-discipline` source and tests are ported from Hosti. Packaging and config are generalized; its semantics are not changed.
- The `no-broken-relative-links` resolution logic and tests are ported from `pubnub/blocksnetwork` `scripts/check-md-links.mjs`. `@eslint/markdown` does the parsing. The hard-coded published subtree became the `roots` option.
- The `recommended` preset does not change when Markdown, design, or capability support changes. The capability rules have their own preset, so a `recommended` consumer gets no new errors on upgrade.
- The migrations bin reads files with regular expressions and a small string lexer, kept in `src/sql-text.mjs`. It has no SQL or TypeScript parser dependency. Its module list check sits in `src/module-list.mjs`.
- The design rules were specified from a read-only probe of Hosti's styles. `tests/fixtures/hosti/` keeps a trimmed copy of real Hosti cases as the parity fixture. The code is written fresh; nothing is copied from `pubnub/blocksnetwork`.
- `tests/fixtures/shadcn-app/` is a small Tailwind v4 app with a `components.json`, a Button with `cva` variants, and a page that breaks each shadcn rule once. `src/pages/brand.ts` holds the colour constants behind the partly verdict in `docs/shadcn.md`.

## Layout

```text
src/        checked-in plugin source and the layout preset
bin/        the pins and migrations bins
tsconfig/   TypeScript config presets
biome/      Biome config preset
tests/      unit, exported-preset, config-preset and bin tests
docs/       focused rule and preset documentation
```

Keep source modules small. Tests should import the package entry point or exercise the exported presets. The pure link-resolution helpers in `src/relative-links.mjs` and `src/repository-paths.mjs`, and the design helpers in `src/colors.mjs`, `src/css-values.mjs`, `src/design-tokens.mjs` and `src/file-globs.mjs`, may also be unit tested directly. Do not add a build step.

## Verification

Run `pnpm run check` and `pnpm run pack:check` in `packages/rules`, and `pnpm check` and `pnpm test` at the repository root. For changes to a config preset, also prove it in a throwaway copy of drunk-cat-stack switched to the presets: `pnpm check` and `pnpm test` pass, and planted violations fail. For release or dependency changes, install the package from a fresh fixture using a pinned Git spec and run ESLint against JavaScript, TypeScript, Markdown, and CSS design pass/fail fixtures. The Markdown fixture must be a git repository with its files added to the index.
