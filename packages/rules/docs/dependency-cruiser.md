# Dependency Cruiser layout preset

Import path: `@house-rules/rules/dependency-cruiser`

This preset is not an ESLint preset. It is a [Dependency Cruiser](https://github.com/sverweij/dependency-cruiser) configuration for a workspace monorepo with apps under `apps/` and packages under `packages/`. The `layout(options)` factory returns a whole config object, `forbidden` rules and `options` together, that a `.dependency-cruiser.cjs` file can export as-is. `tests/fixtures/dependency-cruiser/layout-hosti.snapshot.json` is a snapshot of `layout({ scope: "@hosti/" })`, and a test compares them. The first 13 rules are drunk-cat-stack's hand-written `.dependency-cruiser.cjs` from before 0.4.0. Version 0.4.0 adds three rules, 0.7.0 adds `adapter-imports-only-in-adapters` and keeps `node_modules` in the graph, and 0.8.0 runs that rule at error and lets `adapterImports` name workspace packages, so drunk-cat-stack no longer equals `layout()` until it switches to `layout()`.

```js
// .dependency-cruiser.cjs
module.exports = require("@house-rules/rules/dependency-cruiser").layout({ scope: "@acme/" });
```

Run it with the Dependency Cruiser CLI:

```sh
npx depcruise --config .dependency-cruiser.cjs apps packages
```

The file is CommonJS and loads no other module. It exports `layout` and `DEFAULT_ADAPTER_IMPORTS`, the default `adapterImports` list. `require()` and `import` both work, and neither loads ESLint, `@eslint/css`, or `@eslint/markdown`. Dependency Cruiser is an optional peer dependency (`^18.4.0`), so install it yourself:

```sh
npm install --save-dev --save-exact dependency-cruiser@18.4.0
```

## Expected layout

```text
apps/<app>/src/delivery/       delivery layer
apps/<app>/src/server/         server layer
apps/<app>/src/use-cases/      use-cases layer, one use-case per top-level entry
apps/<app>/src/main.ts         entry files, the only code directly in src/
packages/<pkg>/src/index.ts    the one public entry of a package
packages/<pkg>/src/internal/   private package code
packages/<pkg>/src/adapters/   storage adapters, the only package code that imports SQL or platform packages
<workspace>/src/**/tests/*.test.ts   tests, directly inside a tests folder under src/
```

Every folder name above is an option. The `src` segment is fixed.

## Options

| Option | Default | Meaning |
| --- | --- | --- |
| `scope` | required | npm scope of the workspace packages, such as `"@acme/"`. A missing trailing `/` is added. Used by `no-unresolved-deep-package-imports`. |
| `appsDir` | `"apps"` | Folder that holds the apps. |
| `packagesDir` | `"packages"` | Folder that holds the packages. |
| `layers.delivery` | `"delivery"` | Delivery folder under `<app>/src/`. |
| `layers.server` | `"server"` | Server folder under `<app>/src/`. |
| `layers.useCases` | `"use-cases"` | Use-cases folder under `<app>/src/`. |
| `publicEntry` | `"src/index.ts"` | The only file of a package that another workspace may import. |
| `internalDir` | `"src/internal"` | Private package code that tests may not import. |
| `appEntryFiles` | `["main.ts", "index.ts"]` | File names that may sit directly in `<app>/src/`. Names, not paths. `[]` allows none. |
| `ownerlessNames` | `["utils", "helpers", "misc"]` | File and folder names that `no-ownerless-files` rejects. A name matches `utils.ts`, `utils.test.ts`, `utils/`, but not `string-utils.ts` or `utilities.ts`. Must not be empty. |
| `adaptersDir` | `"src/adapters"` | Package code that may import `adapterImports`. Tests under it may too. |
| `adapterImports` | `DEFAULT_ADAPTER_IMPORTS`: `["effect/unstable/sql", "@effect/sql-*", "@effect/platform-*"]` | Bare import specifiers that only adapter code may import. A `*` matches within one path segment. An entry in `scope`, such as `"@acme/db"`, names a workspace package too. Replaces the default list, so spread `DEFAULT_ADAPTER_IMPORTS` to add to it. Must not be empty. A scoped glob exempts every matching sibling's own folder; see [Adapter imports](#adapter-imports). |
| `adapterPackages` | `[]` | Package folder names under `packagesDir` that are adapters by nature, such as plumbing (`"db"`) or the migration runner (`"migrations"`). Every file in them may import `adapterImports`. Names, not paths. |
| `testsDir` | `"tests"` | Name of the folder every test file must sit in directly, somewhere under `<workspace>/src/`. It also counts as a test path for `production-does-not-import-tests`, next to `test`, `tests`, and `__tests__`. |

Option values are folder names and paths, not regular expressions. The factory escapes them. Each layer root ends in `(?:/|$)`, so `delivery-legacy` is not `delivery`. An unknown option or layer name throws, and so does a path that is empty or starts or ends with `/`. `adapterImportsSeverity` was removed in 0.8.0. Passing it throws, because `adapter-imports-only-in-adapters` is always an error: a repo that breaks it fixes the imports by hand.

## Rules

All 17 rules run at error level. None of them can be turned down to a warning through `layout()`.

| Rule | Reports |
| --- | --- |
| `no-cycles` | Any import cycle. |
| `packages-do-not-import-apps` | A package importing app code. |
| `apps-do-not-import-other-apps` | An app importing another app. |
| `packages-imported-by-name` | A relative-path import into another package. Import it by its package name. |
| `packages-public-entry-only` | Another workspace reaching a package file other than its `publicEntry`. |
| `delivery-does-not-import-server` | Delivery code importing server code. |
| `server-does-not-import-delivery` | Server code importing delivery code. |
| `use-cases-do-not-import-outer-layers` | Use-cases code importing delivery or server code. |
| `no-unresolved-deep-package-imports` | An unresolved deep import such as `@acme/bookings/internal/x`. |
| `production-does-not-import-tests` | Source code under `src/` importing a test file or anything in a test folder. |
| `no-unresolved-imports` | Any import that does not resolve, including a workspace package the importer does not declare. |
| `tests-live-in-tests-dir` | A `*.test.*` or `*.spec.*` file in a workspace that does not sit directly in a `testsDir` folder under `src/`. A package-root `tests/`, a subfolder of `tests/`, and `unit-tests/` all fail. |
| `tests-do-not-import-internals` | A test file, or a file in a test folder, importing `packages/<pkg>/src/internal/`. Test through the public entry. |
| `app-code-in-layers` | A file under `<app>/src/` outside the three layer folders, unless it is an `appEntryFiles` file directly in `src/`. Test files and files in test folders are left to the test rules. |
| `use-cases-do-not-import-use-cases` | A use-case importing another use-case. A use-case is one top-level entry under `use-cases/`: a file, or a folder with everything in it. Imports inside one entry are fine. Test files are never the importer, and a test path is never the target. |
| `no-ownerless-files` | A file or folder named after one of `ownerlessNames`, anywhere under `appsDir` or `packagesDir`. Name the file after what it owns instead. |
| `adapter-imports-only-in-adapters` | A file under `<package>/src/`, outside `adaptersDir` and outside the `adapterPackages`, that imports one of `adapterImports`. A module's domain code talks to its storage port; the SQL lives in its adapters. Tests outside `adaptersDir` count too: run store tests from `src/adapters/tests/`. A package may import its own files, even when `adapterImports` names it; the exception names that package's folder exactly. Apps are not checked, so a server may import `@effect/platform-node`. Several rules share this name, so select them with `filter`, not `find`; see [Adapter imports](#adapter-imports). |

A deep import that does not resolve fires both `no-unresolved-deep-package-imports` and `no-unresolved-imports`. That is intended: the first names the cause.

`tests-live-in-tests-dir`, `app-code-in-layers` and `no-ownerless-files` are module rules, so they report the file itself. A dependency rule would miss a test that imports nothing. Dependency Cruiser has no plain "every module" condition, so the rule uses `numberOfDependentsLessThan: 100`, which every file meets. Module rules see only files Dependency Cruiser parses: JS and TS files. A `utils/` folder that holds only CSS or JSON goes unreported.

## Dependency Cruiser options

The returned `options` block:

- parses with SWC (`parser: "swc"`). Install `@swc/core` for that. Without it, Dependency Cruiser falls back to its other parsers.
- skips `dist`, `coverage`, `generated`, `.turbo`, and `.agent_sources` folders outside `node_modules`. It does not follow `node_modules`, but keeps the packages a file imports in the graph, so `adapter-imports-only-in-adapters` can match their resolved paths, such as `node_modules/.pnpm/effect@<v>/node_modules/effect/dist/unstable/sql/SqlClient.js`. A project that adds `node_modules` to `exclude` turns that rule off.
- sets `skipAnalysisNotInRules: true` and `tsPreCompilationDeps: "specify"`.
- resolves packages through their `exports` field, with the `import`, `require`, `node`, and `default` conditions.

## Adding project rules

`layout()` returns a fresh object on every call. Append your own rules to `forbidden`, or change `options`:

```js
// .dependency-cruiser.cjs
const { layout } = require("@house-rules/rules/dependency-cruiser");

const config = layout({ scope: "@acme/", layers: { useCases: "application" } });
config.forbidden.push({
  name: "no-lodash",
  severity: "error",
  from: {},
  to: { path: "^node_modules/lodash/" },
});
module.exports = config;
```

## Adapter imports

`adapter-imports-only-in-adapters` matches each import by its resolved path under `node_modules`. `effect/unstable/sql` becomes `(?:^|/)node_modules/effect/(?:[^/]+/|)unstable/sql(?:[/.]|$)`: the subpath may sit one folder down, such as `dist/`, as `exports` maps usually put it. A specifier with no subpath, such as `@effect/sql-*`, matches the whole package. An import that does not resolve is left to `no-unresolved-imports`.

A workspace package resolves through its pnpm link to its own folder, not to `node_modules`. So an entry that starts with `scope`, such as `@acme/db`, matches two paths: `(?:^|/)node_modules/@acme/db/`, and `^packages/db/`, the folder under `packagesDir` named after the part after the scope. A package whose folder name differs from its package name is not matched there; name the folder after the package.

A scoped glob entry, such as `@acme/sql-*`, exempts the own folder of every sibling it matches, so `sql-a` may import `sql-b`. List literal package names when that matters.

```js
// .dependency-cruiser.cjs
const { DEFAULT_ADAPTER_IMPORTS, layout } = require("@house-rules/rules/dependency-cruiser");

// packages/db holds the SQL client; only adapters and db itself may import it.
module.exports = layout({
  scope: "@acme/",
  adapterPackages: ["db"],
  adapterImports: [...DEFAULT_ADAPTER_IMPORTS, "@acme/db"],
});
```

`adapterPackages` still names the plumbing packages that may import the list. A domain file under `packages/trips/src/` that imports `@acme/db` fails; `packages/trips/src/adapters/postgres/trip-store.ts` may.

The fence is several rules that share the name `adapter-imports-only-in-adapters`: one for installed paths, and one for each listed workspace package. A thin config that overrides the whole fence must use `forbidden.filter(r => r.name === "adapter-imports-only-in-adapters")`. `find` returns only the installed-path rule.
