# @house-rules/rules

House rules and house configs. One exact GitHub commit pin brings all of it: nine ESLint rules, 21 Dependency Cruiser layout rules, TypeScript strict flags, Effect diagnostics, Biome linter and formatter, an exact-pins checker, and a module-owned SQL checker. It also ships a preset that turns on the six rules of `@shadcn/lint` for Tailwind v4 apps. Private, not on npm.

## Install

Node `>=24.21.0` only. The pins and migrations bins use `fs.globSync`, with no fallback for older Node. The package lives in `packages/rules` of the house-rules repository, so install it with pnpm and a Git subpath spec. The pins bin reads `pnpm-workspace.yaml`, so the app needs one.

```json
{
  "devDependencies": {
    "@house-rules/rules": "github:JakubSzwajka/house-rules#<full-40-char-sha>&path:/packages/rules"
  }
}
```

`@eslint/css`, `@eslint/markdown`, `@shadcn/lint`, and `dependency-cruiser` are optional peer dependencies, so pnpm does not install them. Install the ones your entry points need, each pinned exactly. Importing `/design` without `@eslint/css`, or `/shadcn` without `@shadcn/lint`, fails with `ERR_MODULE_NOT_FOUND`.

| Entry point | Install in the app, exact pin |
| --- | --- |
| `@house-rules/rules` | `eslint` `10.11.0` |
| `@house-rules/rules/markdown` | `@eslint/markdown` `8.0.3` |
| `@house-rules/rules/design` | `@eslint/css` `2.0.0` |
| `@house-rules/rules/shadcn` | `@shadcn/lint` `0.2.0` |
| `@house-rules/rules/dependency-cruiser` | `dependency-cruiser` `18.4.0` |
| `@house-rules/rules/biome` | `@biomejs/biome` `2.5.14` |
| `@house-rules/rules/tsconfig/*.json` | `typescript`, nothing else |

### Migrating from @jakubszwajka/house-rules

The package used to be called `@jakubszwajka/house-rules`. In the app's `package.json`, replace that dependency key with `@house-rules/rules` and use the spec above. In `eslint.config.mjs`, `biome.json`, `tsconfig.json`, and `.dependency-cruiser.cjs`, replace each `@jakubszwajka/house-rules` import or `extends` with `@house-rules/rules`. Rename the `packageExtensions` key in `pnpm-workspace.yaml` the same way. Subpath names do not change. An old pin keeps working until you move it, because the old commits are in this repo's history.

## Rules and checks

| Rule | Catches | Tool | Enable via | Docs |
| --- | --- | --- | --- | --- |
| `comment-discipline` | Top-level narrative, multiline comments, adjacent groups; keeps one-line whys beside code | ESLint | `configs.recommended` | [comment-discipline.md](docs/comment-discipline.md) |
| `no-broken-relative-links` | Relative Markdown links to untracked paths | ESLint | `@house-rules/rules/markdown` | [no-broken-relative-links.md](docs/no-broken-relative-links.md) |
| `design-no-raw-color` | Raw hex, rgb(), hsl(), etc. in CSS | ESLint | `design()` factory | [design-no-raw-color.md](docs/design-no-raw-color.md) |
| `design-no-raw-color-literal` | Raw hex, rgb(), hsl(), etc. in JS/TS strings | ESLint | `design()` factory | [design-no-raw-color-literal.md](docs/design-no-raw-color-literal.md) |
| `design-no-unknown-token` | `var(--name)` with no definition | ESLint | `design()` factory | [design-no-unknown-token.md](docs/design-no-unknown-token.md) |
| `design-scale-value` | CSS values off a fixed scale | ESLint | `design()` factory | [design-scale-value.md](docs/design-scale-value.md) |
| `shadcn/*` (six rules from `@shadcn/lint`) | Restyled design-system components, raw palette colours, arbitrary values, inline styles, dynamic class names, and unknown Tailwind classes in JSX and TSX | ESLint | `shadcn()` factory | `docs/shadcn.md` |
| `use-case-is-capability` | A use-case file that does not export exactly one `implement(...)` capability, exports a second contract, or exports another value | ESLint | `configs.capability` | [use-case-is-capability.md](docs/use-case-is-capability.md) |
| `no-hand-rolled-surface` | `Tool.make`, `Rpc.make`, or `HttpApiEndpoint.<method>` outside `packages/capability/**` | ESLint | `configs.capability` | [no-hand-rolled-surface.md](docs/no-hand-rolled-surface.md) |
| `no-hand-run-effect` | `Effect.run*` or `ManagedRuntime.make` in a test file; tests use `it.effect` or `it.layer` | ESLint | `configs.capability` | [no-hand-run-effect.md](docs/no-hand-run-effect.md) |
| `no-cycles` | Circular imports | Dependency Cruiser | `layout({ scope })` | [dependency-cruiser.md](docs/dependency-cruiser.md) |
| `packages-do-not-import-apps` | Packages importing apps | Dependency Cruiser | `layout({ scope })` | [dependency-cruiser.md](docs/dependency-cruiser.md) |
| `apps-do-not-import-other-apps` | Apps importing other apps | Dependency Cruiser | `layout({ scope })` | [dependency-cruiser.md](docs/dependency-cruiser.md) |
| `packages-imported-by-name` | Local imports of packages by path instead of name | Dependency Cruiser | `layout({ scope })` | [dependency-cruiser.md](docs/dependency-cruiser.md) |
| `packages-public-entry-only` | Imports of package internals | Dependency Cruiser | `layout({ scope })` | [dependency-cruiser.md](docs/dependency-cruiser.md) |
| `delivery-does-not-import-server` | Delivery layer importing server layer | Dependency Cruiser | `layout({ scope })` | [dependency-cruiser.md](docs/dependency-cruiser.md) |
| `server-does-not-import-delivery` | Server layer importing delivery layer | Dependency Cruiser | `layout({ scope })` | [dependency-cruiser.md](docs/dependency-cruiser.md) |
| `use-cases-do-not-import-outer-layers` | Use-cases importing delivery or server | Dependency Cruiser | `layout({ scope })` | [dependency-cruiser.md](docs/dependency-cruiser.md) |
| `no-unresolved-deep-package-imports` | Unresolved deep package imports | Dependency Cruiser | `layout({ scope })` | [dependency-cruiser.md](docs/dependency-cruiser.md) |
| `production-does-not-import-tests` | Production code importing tests | Dependency Cruiser | `layout({ scope })` | [dependency-cruiser.md](docs/dependency-cruiser.md) |
| `tests-live-in-tests-dir` | Test files outside tests/ folders | Dependency Cruiser | `layout({ scope })` | [dependency-cruiser.md](docs/dependency-cruiser.md) |
| `tests-do-not-import-internals` | Tests importing package internals | Dependency Cruiser | `layout({ scope })` | [dependency-cruiser.md](docs/dependency-cruiser.md) |
| `no-unresolved-imports` | Unresolved imports | Dependency Cruiser | `layout({ scope })` | [dependency-cruiser.md](docs/dependency-cruiser.md) |
| `app-code-in-layers` | App code outside layer folders | Dependency Cruiser | `layout({ scope })` | [dependency-cruiser.md](docs/dependency-cruiser.md) |
| `use-cases-do-not-import-use-cases` | Use-case importing another use-case | Dependency Cruiser | `layout({ scope })` | [dependency-cruiser.md](docs/dependency-cruiser.md) |
| `no-ownerless-files` | `utils/`, `helpers/`, `misc/` files or folders, and mechanism names (`types`, `errors`, `validation`, `internal`, ...) in packages, in any letter case | Dependency Cruiser | `layout({ scope })` | [dependency-cruiser.md](docs/dependency-cruiser.md) |
| `package-root-files` | A loose file in a package's `src/` other than `index.ts`, `facade.ts`, `storage.ts` | Dependency Cruiser | `layout({ scope })` | [dependency-cruiser.md](docs/dependency-cruiser.md#package-layout) |
| `domain-does-not-import-adapters` | A package file other than `index.ts`, `facade.ts`, or an adapter importing the package's own `src/adapters/` | Dependency Cruiser | `layout({ scope })` | [dependency-cruiser.md](docs/dependency-cruiser.md#package-layout) |
| `subjects-do-not-import-package-root` | A file in a subject folder importing its own package's `index.ts` or `facade.ts` | Dependency Cruiser | `layout({ scope })` | [dependency-cruiser.md](docs/dependency-cruiser.md#package-layout) |
| `no-subject-folder-cycles` | Two subject folders of one package importing each other | Dependency Cruiser | `layout({ scope })` | [dependency-cruiser.md](docs/dependency-cruiser.md#package-layout) |
| `adapter-imports-only-in-adapters` | A package file outside `src/adapters/` importing `effect/unstable/sql`, `@effect/sql-*`, `@effect/platform-*`, or a workspace package listed in `adapterImports` (always an error) | Dependency Cruiser | `layout({ scope })` | [dependency-cruiser.md](docs/dependency-cruiser.md) |
| Strict compiler flags | 15 flags: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, and more | TypeScript | `tsconfig/strict.json` | [tsconfig.md](docs/tsconfig.md) |
| Effect diagnostics | 31 diagnostics set to error | TypeScript | `tsconfig/effect.json` | [tsconfig.md](docs/tsconfig.md) |
| `noReExportAll` | `export * from` | Biome | `@house-rules/rules/biome` | [biome.md](docs/biome.md) |
| `noExcessiveLinesPerFile` | Files over 300 lines (warn) | Biome | `@house-rules/rules/biome` | [biome.md](docs/biome.md) |
| `noNonNullAssertion` | `!` non-null assertions | Biome | `@house-rules/rules/biome` | [biome.md](docs/biome.md) |
| `useFilenamingConvention` | Files not kebab-case or export | Biome | `@house-rules/rules/biome` | [biome.md](docs/biome.md) |
| Formatter | indentWidth 2, lineWidth 100, indentStyle space | Biome | `@house-rules/rules/biome` | [biome.md](docs/biome.md) |
| Exact pins | Every dependency must be an exact version, `workspace:<exact>`, or a Git spec with full commit SHA | Node | `house-rules-pins` bin | [pins.md](docs/pins.md) |
| `house-rules-migrations` | Cross-module foreign keys, migrations or SQL strings that touch another package's tables, `.sql` files outside `<package>/migrations/` (a package's `fixtures/` and `tests/` excepted), a raw `withTransaction` or `begin` outside an adapter package, a module that opens a unit of work, a module with migrations that `migrations.json` does not list | Node | `house-rules-migrations` bin | [migrations.md](docs/migrations.md) |

## Wire it up

```js
// eslint.config.mjs
import houseRules from "@house-rules/rules";
import houseRulesMarkdown from "@house-rules/rules/markdown";
import design from "@house-rules/rules/design";
import shadcn from "@house-rules/rules/shadcn";

export default [
  { ignores: ["dist/**", "coverage/**"] },
  ...houseRules.configs.recommended,
  ...houseRules.configs.capability,
  ...houseRulesMarkdown,
  ...design({
    tokenFiles: ["src/styles/tokens.css"],
    css: { files: ["**/*.css"] },
    source: { files: ["**/*.{ts,tsx}"] },
    rules: { "design-scale-value": [{ property: "^border-radius$", allowed: ["0", "4px", "8px"] }] },
  }),
  ...shadcn({ components: ["src/components/ui/**"], severity: "warn" }),
  // Override narrowly with a reason:
  { files: ["scripts/vendor/**"], rules: { "house-rules/comment-discipline": "off" } },
];
```

```js
// .dependency-cruiser.cjs
module.exports = require("@house-rules/rules/dependency-cruiser").layout({
  scope: "@acme/",
});
```

```json
// tsconfig.base.json
{
  "extends": "@house-rules/rules/tsconfig/effect.json"
}
```

```json
// biome.json
{
  "$schema": "https://biomejs.dev/schemas/2.5.14/schema.json",
  "extends": ["@house-rules/rules/biome"],
  "files": {
    "includes": ["**", "!!node_modules", "!!dist", "!!coverage"]
  }
}
```

```json
// package.json
{
  "scripts": {
    "pins": "house-rules-pins",
    "migrations": "house-rules-migrations"
  }
}
```

`configs.capability` runs `no-hand-rolled-surface` on JS, JSX, MJS, CJS, TS, TSX, MTS, and CTS files, `use-case-is-capability` on TS, TSX, MTS, and CTS files, and `no-hand-run-effect` on test files: anything under a `tests/` folder or named `*.test.*` or `*.spec.*`. Its defaults match the stack layout: use-cases in `apps/*/src/use-cases/`, surfaces built only in `packages/capability/`. Set the `include`, `exclude`, or `allow` option only when the layout differs.

`shadcn()` runs `@shadcn/lint` on JSX and TSX with the setup its adoption guide gives: five rules at `error` and `no-unknown-classes` at `warn`, with three rules off in the component folder. An app that already has findings starts with `severity: "warn"`, as above. `docs/shadcn.md` covers the options, the TypeScript 7 caveat, and how it overlaps the design rules.

Biome replaces an extended `files.includes` instead of merging, so it stays in the consumer. See per-tool docs for options, detailed behavior, and limitations.

## Commands

```sh
pnpm test           # Run tests
pnpm run check      # Tests, then a syntax check of every source file
pnpm run pack:check # Verify tarball
```

## Upgrade flow

1. Review the commit diff and rule docs between current and candidate commit.
2. Update the commit SHA in `package.json`, regenerate lockfile.
3. Run `pnpm run check`, `pnpm run pack:check`, and consumer checks (ESLint, Biome, typecheck, Dependency Cruiser, pins).
4. Merge lockfile and config changes together. Do not npm-publish.
