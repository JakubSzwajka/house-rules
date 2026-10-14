# @house-rules/rules

House rules and house configs. One exact pin brings all of it: thirteen ESLint rules, 23 Dependency Cruiser layout rules, subject-folder and package-cycle checks, TypeScript strict flags, a web preset for bundled UI code, Effect diagnostics, Biome linter and formatter with Tailwind v4 parsing, an exact-pins checker, and a module-owned SQL checker. It also ships a preset that turns on the six rules of `@shadcn/lint` for Tailwind v4 apps. Published to npm as `@house-rules/rules`.

## Install

Node `>=24.21.0` only. The pins and migrations bins use `fs.globSync`, with no fallback for older Node. Install it from npm with an exact pin. The pins bin reads `pnpm-workspace.yaml`; the layout bin reads `.dependency-cruiser.cjs` and needs `dependency-cruiser` installed.

```json
{
  "devDependencies": {
    "@house-rules/rules": "0.17.0"
  }
}
```

Up to 0.14.0 the package was not on npm, and apps pinned a commit with `github:JakubSzwajka/house-rules#<sha>&path:/packages/rules`. That spec still works for those commits. To move, replace it with the exact version and run `pnpm install`.

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
| `design-css-layers` | App CSS rules outside an allowed `@layer`, a restricted layer outside its files, and `!important` (opt-in) | ESLint | `design()` factory | `docs/design-css-layers.md` |
| `design-no-raw-element` | A raw `<button>`, `<input>`, `<select>` and the like in JSX where the component folder has a component for it | ESLint | `shadcn()` factory | `docs/design-no-raw-element.md` |
| `shadcn/*` (six rules from `@shadcn/lint`) | Restyled design-system components, raw palette colours, arbitrary values, inline styles, dynamic class names, and unknown Tailwind classes in JSX and TSX | ESLint | `shadcn()` factory | `docs/shadcn.md` |
| `use-case-is-capability` | A use-case file that does not export exactly one `implement(...)` capability, exports a second contract, or exports another value | ESLint | `configs.capability` | [use-case-is-capability.md](docs/use-case-is-capability.md) |
| `no-hand-rolled-surface` | `Tool.make`, `Rpc.make`, or `HttpApiEndpoint.<method>` outside `packages/application/**` | ESLint | `configs.capability` | [no-hand-rolled-surface.md](docs/no-hand-rolled-surface.md) |
| `no-hand-run-effect` | `Effect.run*` or `ManagedRuntime.make` in a test file; tests use `it.effect` or `it.layer` | ESLint | `configs.capability` | [no-hand-run-effect.md](docs/no-hand-run-effect.md) |
| `no-computed-import` | An `import()` or `require()` whose specifier is not a string literal, in a package's source; no graph check can see where it leads | ESLint | `configs.capability` | `docs/no-computed-import.md` |
| `testing-exports-only-in-tests` | A name that ends in `Testing`, a package's testing export, used outside a test file and outside testing code, a file whose runtime exports are all named `*Testing`; also a path re-export that renames one | ESLint | `configs.testing`, `configs.capability` | [testing-exports-only-in-tests.md](docs/testing-exports-only-in-tests.md) |
| `no-cycles` | Circular imports | Dependency Cruiser | `layout({ scope })` | [dependency-cruiser.md](docs/dependency-cruiser.md) |
| `packages-do-not-import-apps` | Packages importing apps | Dependency Cruiser | `layout({ scope })` | [dependency-cruiser.md](docs/dependency-cruiser.md) |
| `apps-do-not-import-other-apps` | Apps importing other apps | Dependency Cruiser | `layout({ scope })` | [dependency-cruiser.md](docs/dependency-cruiser.md) |
| `packages-imported-by-name` | Local imports of packages by path instead of name | Dependency Cruiser | `layout({ scope })` | [dependency-cruiser.md](docs/dependency-cruiser.md) |
| `packages-public-entry-only` | Imports of package internals | Dependency Cruiser | `layout({ scope })` | [dependency-cruiser.md](docs/dependency-cruiser.md) |
| `contract-entry-is-browser-safe` | A package's `src/contract.ts` reaching server code: adapters, `storage.ts`, `facade.ts`, any package's `index.ts`, `node:` modules, any installed package but the allowlisted `effect` modules and trusted contract entries; and, through `house-rules-layout`, a manifest that exports any key or pattern but `.` and `./contract`, or points either at another file | Dependency Cruiser | `layout({ scope })`, `house-rules-layout` bin | [dependency-cruiser.md](docs/dependency-cruiser.md#contract-entry) |
| `delivery-does-not-import-server` | Delivery layer reaching server layer, directly or through any file | Dependency Cruiser | `layout({ scope })` | [dependency-cruiser.md](docs/dependency-cruiser.md) |
| `server-does-not-import-delivery` | Server layer reaching delivery layer, directly or through any file | Dependency Cruiser | `layout({ scope })` | [dependency-cruiser.md](docs/dependency-cruiser.md) |
| `use-cases-do-not-import-outer-layers` | Use-cases reaching delivery or server, directly or through any file | Dependency Cruiser | `layout({ scope })` | [dependency-cruiser.md](docs/dependency-cruiser.md) |
| `composition-imports-packages-only` | The app's `src/composition/` importing any other app file: delivery, server, a use-case, an entry file | Dependency Cruiser | `layout({ scope })` | [dependency-cruiser.md](docs/dependency-cruiser.md#composition) |
| `use-cases-do-not-import-composition` | A use-case reaching `src/composition/`, directly or through any file; its tests may import it | Dependency Cruiser | `layout({ scope })` | [dependency-cruiser.md](docs/dependency-cruiser.md#composition) |
| `no-unresolved-deep-package-imports` | Unresolved deep package imports | Dependency Cruiser | `layout({ scope })` | [dependency-cruiser.md](docs/dependency-cruiser.md) |
| `production-does-not-import-tests` | Production code importing tests | Dependency Cruiser | `layout({ scope })` | [dependency-cruiser.md](docs/dependency-cruiser.md) |
| `tests-live-in-tests-dir` | Test files outside tests/ folders | Dependency Cruiser | `layout({ scope })` | [dependency-cruiser.md](docs/dependency-cruiser.md) |
| `tests-do-not-import-internals` | Tests importing package internals | Dependency Cruiser | `layout({ scope })` | [dependency-cruiser.md](docs/dependency-cruiser.md) |
| `no-unresolved-imports` | Unresolved imports | Dependency Cruiser | `layout({ scope })` | [dependency-cruiser.md](docs/dependency-cruiser.md) |
| `app-code-in-layers` | App code outside layer folders | Dependency Cruiser | `layout({ scope })` | [dependency-cruiser.md](docs/dependency-cruiser.md) |
| `use-cases-do-not-import-use-cases` | Use-case reaching another use-case, directly or through any file | Dependency Cruiser | `layout({ scope })` | [dependency-cruiser.md](docs/dependency-cruiser.md) |
| `no-ownerless-files` | `utils/`, `helpers/`, `misc/` files or folders, and mechanism names (`types`, `errors`, `validation`, `internal`, ...) in packages, in any letter case | Dependency Cruiser | `layout({ scope })` | [dependency-cruiser.md](docs/dependency-cruiser.md) |
| `package-root-files` | A loose file in a package's `src/` other than `index.ts`, `facade.ts`, `storage.ts`, `contract.ts` | Dependency Cruiser | `layout({ scope })` | [dependency-cruiser.md](docs/dependency-cruiser.md#package-layout) |
| `domain-does-not-import-adapters` | Only `index.ts`, `facade.ts`, and files under `src/adapters/` may import the package's own adapters; test files may also import `src/adapters/tests/`, but no other file may | Dependency Cruiser | `layout({ scope })` | [dependency-cruiser.md](docs/dependency-cruiser.md#package-layout) |
| `subjects-do-not-import-package-root` | A file in a subject folder importing its own package's `index.ts` or `facade.ts` | Dependency Cruiser | `layout({ scope })` | [dependency-cruiser.md](docs/dependency-cruiser.md#package-layout) |
| `no-subject-folder-cycles` | Subject folders of one package importing each other in a cycle, even when no file-level cycle exists | Node | `house-rules-layout` bin | [dependency-cruiser.md](docs/dependency-cruiser.md#package-layout) |
| `no-package-cycles` | Workspace packages importing each other in a production cycle, even when no file-level cycle exists | Node | `house-rules-layout` bin | [dependency-cruiser.md](docs/dependency-cruiser.md#package-layout) |
| `adapter-imports-only-in-adapters` | A package file outside `src/adapters/` importing `effect/sql` or `effect/unstable/sql`, `@effect/sql-*`, `@effect/platform-*`, or a workspace package listed in `adapterImports` (always an error) | Dependency Cruiser | `layout({ scope })` | [dependency-cruiser.md](docs/dependency-cruiser.md) |
| Strict compiler flags | 15 flags: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, and more | TypeScript | `tsconfig/strict.json` | [tsconfig.md](docs/tsconfig.md) |
| Effect diagnostics | 31 diagnostics set to error | TypeScript | `tsconfig/effect.json` | [tsconfig.md](docs/tsconfig.md) |
| `noReExportAll` | `export * from` | Biome | `@house-rules/rules/biome` | [biome.md](docs/biome.md) |
| `noExcessiveLinesPerFile` | Files over 300 lines (warn) | Biome | `@house-rules/rules/biome` | [biome.md](docs/biome.md) |
| `noNonNullAssertion` | `!` non-null assertions | Biome | `@house-rules/rules/biome` | [biome.md](docs/biome.md) |
| `useFilenamingConvention` | Files not kebab-case or export | Biome | `@house-rules/rules/biome` | [biome.md](docs/biome.md) |
| Formatter | indentWidth 2, lineWidth 100, indentStyle space | Biome | `@house-rules/rules/biome` | [biome.md](docs/biome.md) |
| Exact pins | Every dependency must be an exact version, `workspace:<exact>`, or a Git spec with full commit SHA | Node | `house-rules-pins` bin | [pins.md](docs/pins.md) |
| `house-rules-migrations` | Cross-module foreign keys, migrations or SQL strings that touch another package's tables, `.sql` files outside `<package>/migrations/` (a package's `fixtures/` and `tests/` excepted), a raw `withTransaction` or `begin` outside an adapter package, a module that opens a unit of work, a module with migrations that `migrations.json` does not list | Node | `house-rules-migrations` bin | [migrations.md](docs/migrations.md) |

Each rule's row on [the rules page](https://stack.kubaszwajka.com/rules/) has an anchor, such as `/rules/#comment-discipline`. A failing ESLint rule sets that link as `meta.docs.url`, a Dependency Cruiser rule carries it in its `comment`, which only the `err-long` reporter prints (the root `deps` script passes `--output-type err-long`), and each bin ends its failure report with a `See <link>` line. The ESLint formatter `@house-rules/rules/eslint-formatter` prints ESLint's stylish output unchanged, then one `See <link>  (<rule id>)` line per failing house rule, and skips third-party rules; run it with `eslint --format ./node_modules/@house-rules/rules/src/eslint-formatter.mjs .`. ESLint 10.11.0 rejects `--format @house-rules/rules/eslint-formatter`, an arbitrary package subpath export, which is why the lint script uses a `node_modules` path. `src/rule-docs.mjs` builds the links, and `tests/rule-docs.test.mjs` checks that each one names a row in this table.

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
    rules: {
      "design-scale-value": [{ property: "^border-radius$", allowed: ["0", "4px", "8px"] }],
      "design-css-layers": { layers: ["components"] },
    },
  }),
  ...shadcn({
    components: ["src/components/ui/**"],
    severity: "warn",
    rawElements: { elements: { a: { use: "Link", from: "next/link" } } },
  }),
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
    "migrations": "house-rules-migrations",
    "layout": "house-rules-layout"
  }
}
```

`configs.capability` runs `no-hand-rolled-surface` on JS, JSX, MJS, CJS, TS, TSX, MTS, and CTS files, `use-case-is-capability` on TS, TSX, MTS, and CTS files, `no-hand-run-effect` on test files: anything under a `tests/` folder or named `*.test.*` or `*.spec.*`, `no-computed-import` on production files under `packages/*/src/`, and `testing-exports-only-in-tests` on every JS and TS file, where it passes those same test files. `configs.testing` runs that last rule alone, for an app with no capabilities; `configs.capability` includes it, so spread one or the other. Its defaults match the stack layout: use-cases in `apps/*/src/use-cases/`, surfaces built only in `packages/application/`. Set the `include`, `exclude`, or `allow` option only when the layout differs. When `layout()` gets another `packagesDir`, spread `capabilityConfig({ packagesDir })`, a named export of the package root, in place of `configs.capability`, so `no-computed-import` covers the same packages.

`shadcn()` runs `@shadcn/lint` on JSX and TSX with the setup its adoption guide gives: five rules at `error` and `no-unknown-classes` at `warn`, with three rules off in the component folder. It adds `design-no-raw-element` at `error`, off in the component folder too. An app that already has findings starts with `severity: "warn"`, as above. `docs/shadcn.md` covers the options, the TypeScript 7 caveat, how it overlaps the design rules, and three settings that make the utility checks stricter.

`design-css-layers` is opt-in: `design()` turns it on once you pass its `layers`. Token files are exempt unless you set `checkTokenFiles: true`.

Biome replaces an extended `files.includes` instead of merging, so it stays in the consumer. See per-tool docs for options, detailed behavior, and limitations.

### A web app

A web app, Next.js, Vite, Remix, Astro or similar, checks its UI with `tsconfig/web.json` (DOM libs, bundler resolution, no plugin block) and its Effect code with a second tsconfig that lists `effect.json` first and `web.json` second. The Biome preset already parses Tailwind v4 directives. Its pages reach use-cases through the app's `src/composition/` and the delivery adapters, never through the server folder. [tsconfig.md](docs/tsconfig.md#webjson), [biome.md](docs/biome.md#tailwind-css) and [dependency-cruiser.md](docs/dependency-cruiser.md#web-apps) have the details.

A Next.js app names the host once on each side, and House Rules knows Next's files from there:

```json
// apps/web/tsconfig.json
{
  "extends": "@house-rules/rules/tsconfig/next.json",
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules", ".next"]
}
```

```json
// apps/web/tsconfig.effect.json
{
  "extends": ["@house-rules/rules/tsconfig/effect.json", "@house-rules/rules/tsconfig/web.json"],
  "include": ["src/composition/**/*.ts", "src/server/**/*.ts", "src/use-cases/**/*.ts"]
}
```

```js
// .dependency-cruiser.cjs
module.exports = require("@house-rules/rules/dependency-cruiser").layout({
  scope: "@acme/",
  host: "next",
});

// eslint.config.mjs
...houseRules.configs.nextHost,
...shadcn({ host: "next" }),
```

`host: "next"` makes `src/app/` the delivery folder, allows `src/proxy.ts` and `src/instrumentation.ts`, treats `next-env.d.ts` as a generated declaration and leaves `.next/` out. `configs.nextHost` is the ESLint side of that: one global-ignores block for `**/.next/**` and `**/next-env.d.ts`, so ESLint never lints build output or the generated file. `tsconfig/next.json` sets `allowJs: false` and adds `esModuleInterop`, `resolveJsonModule`, `jsx: "react-jsx"` and the `next` plugin to `web.json`. Next 16 never rewrites a tsconfig that uses `extends`, so these options must come from the preset. The Effect tsconfig keeps `web.json`, because `next.json`'s `plugins` would replace the Effect block. In `shadcn()`, the host lets `app/global-error.tsx` use raw elements and inline styles. Next renders that file in place of the root layout, so the app's components and stylesheet may not be loaded there. Every other rule stays on in that file, and every other file keeps both rules.

## Commands

```sh
pnpm test           # Run tests
pnpm run check      # Tests, then a syntax check of every source file
pnpm run layout     # Check production subject-folder and package cycles
pnpm run pack:check # Verify tarball
```

## Upgrade flow

1. Review the rule docs and the diff between the current and the candidate version.
2. Update the exact version in `package.json`, regenerate lockfile.
3. Run `pnpm run check`, `pnpm run pack:check`, and consumer checks (ESLint, Biome, typecheck, Dependency Cruiser, pins).
   0.16.0 is breaking: `serverEntryFiles` is gone. Follow [Upgrading to 0.16.0](docs/dependency-cruiser.md#upgrading-to-0160).
   0.16.1 tightens two Next host defaults: `main.ts` and `index.ts` are no longer host entry files, and `tsconfig/next.json` sets `allowJs: false`, so an app that imports a `.js` file gives it types or converts it to TypeScript.
   0.16.2 adds stable Effect import paths: the SQL fence covers `effect/sql`, the browser allowlist covers `effect/http`, and `no-hand-rolled-surface` covers `effect/ai`, `effect/rpc` and `effect/http-api`. The RC paths stay checked too.
   0.17.0 follows the split of `@house-rules/capability` into `@house-rules/domain` and `@house-rules/application`. See [Upgrading to 0.17.0](#upgrading-to-0170).
4. Merge lockfile and config changes together.

### Upgrading to 0.17.0

`@house-rules/capability` is gone; `@house-rules/domain` and `@house-rules/application` replace it. The checks now look for the new names:

- `use-case-is-capability` counts only `implement` from `@house-rules/application`.
- `no-hand-rolled-surface` allows `packages/application/**` by default.
- `contract-entry-is-browser-safe` trusts the installed `./contract` entries of `@house-rules/application` and `@house-rules/domain`, and no longer trusts `@house-rules/capability`.
- `house-rules-migrations` exempts `@house-rules/application`, whose `sqlUnitOfWork` opens the transaction, and `@house-rules/domain`, which defines `UnitOfWork.atomic`, in place of `@house-rules/capability`.

Move each import to the kit that owns the name before you bump the pin.

### Upgrading to 0.16.3

This is a docs-only update: a plain Node app mounts `@house-rules/node-host` in `src/main.ts`; `src/server/` is for background loops. No rule or preset changes.

The repo's publish workflow, not a person, publishes a new version to npm.
