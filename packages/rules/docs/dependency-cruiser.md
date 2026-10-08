# Dependency Cruiser layout preset

Import path: `@house-rules/rules/dependency-cruiser`

This preset is not an ESLint preset. It is a [Dependency Cruiser](https://github.com/sverweij/dependency-cruiser) configuration for a workspace monorepo with apps under `apps/` and packages under `packages/`. The `layout(options)` factory returns a whole config object, `forbidden` rules and `options` together, that a `.dependency-cruiser.cjs` file can export as-is. `tests/fixtures/dependency-cruiser/layout-hosti.snapshot.json` is a snapshot of `layout({ scope: "@hosti/" })`, and a test compares them. The first 13 rules are drunk-cat-stack's hand-written `.dependency-cruiser.cjs` from before 0.4.0. Version 0.4.0 adds three rules, 0.7.0 adds `adapter-imports-only-in-adapters` and keeps `node_modules` in the graph, 0.8.0 runs that rule at error and lets `adapterImports` name workspace packages, and 0.10.0 adds the package layout rules (`package-root-files`, `domain-does-not-import-adapters`, `subjects-do-not-import-package-root`, `no-subject-folder-cycles`, and mechanism names in `no-ownerless-files`), so drunk-cat-stack no longer equals `layout()` until it switches to `layout()`.

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
packages/<pkg>/src/facade.ts   the service and its layers, wiring the default adapters
packages/<pkg>/src/storage.ts  the storage port
packages/<pkg>/src/<subject>/  one folder per subject: its schema, errors and logic
packages/<pkg>/src/adapters/   storage adapters, the only package code that imports SQL or platform packages
<workspace>/src/**/tests/*.test.ts   tests, directly inside a tests folder under src/
```

Every folder name above is an option. The `src` segment is fixed. Every file but the public entry is private, because `packages-public-entry-only` lets no other workspace import it, so a package needs no `internal/` folder, and `internal` is a default mechanism name. `internalDir` still names one for `tests-do-not-import-internals`, for packages that keep it.

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
| `internalDir` | `"src/internal"` | Private package code that tests may not import. Subject folders replace it; see [Package layout](#package-layout). |
| `appEntryFiles` | `["main.ts", "index.ts"]` | File names that may sit directly in `<app>/src/`. Names, not paths. `[]` allows none. |
| `ownerlessNames` | `["utils", "helpers", "misc"]` | File and folder names that `no-ownerless-files` rejects. A name matches `utils.ts`, `utils.test.ts`, `utils/`, but not `string-utils.ts` or `utilities.ts`. Must not be empty. |
| `mechanismNames` | `["types", "models", "schemas", "drafts", "errors", "validate", "validation", "constants", "interfaces", "internal"]` | File and folder names that `no-ownerless-files` rejects inside a package under `packagesDir`, not in apps. Matched by whole name, like `ownerlessNames`, so `item-errors.ts` passes, and in any letter case, so `Types.ts` and `Errors/` fail. (`ownerlessNames` stay case-sensitive.) Replaces the default list. `[]` turns the check off. |
| `packageRootFiles` | `["index.ts", "facade.ts", "storage.ts"]` | File names that may sit directly in `<package>/src/`. Names, not paths. Must not be empty. |
| `facadeFile` | `"src/facade.ts"` | The package file that may import the package's own `adaptersDir`, next to `publicEntry`. |
| `adaptersDir` | `"src/adapters"` | Package code that may import `adapterImports`. Tests under it may too. |
| `adapterImports` | `DEFAULT_ADAPTER_IMPORTS`: `["effect/unstable/sql", "@effect/sql-*", "@effect/platform-*"]` | Bare import specifiers that only adapter code may import. A `*` matches within one path segment. An entry in `scope`, such as `"@acme/db"`, names a workspace package too. Replaces the default list, so spread `DEFAULT_ADAPTER_IMPORTS` to add to it. Must not be empty. A scoped glob exempts every matching sibling's own folder; see [Adapter imports](#adapter-imports). |
| `adapterPackages` | `[]` | Package folder names under `packagesDir` that are adapters by nature, such as plumbing (`"db"`) or the migration runner (`"migrations"`). Every file in them may import `adapterImports`. Names, not paths. |
| `testsDir` | `"tests"` | Name of the folder every test file must sit in directly, somewhere under `<workspace>/src/`. It also counts as a test path for `production-does-not-import-tests`, next to `test`, `tests`, and `__tests__`. |

Option values are folder names and paths, not regular expressions. The factory escapes them. Each layer root ends in `(?:/|$)`, so `delivery-legacy` is not `delivery`. An unknown option or layer name throws, and so does a path that is empty or starts or ends with `/`. `adapterImportsSeverity` was removed in 0.8.0. Passing it throws, because `adapter-imports-only-in-adapters` is always an error: a repo that breaks it fixes the imports by hand.

## Rules

All 21 rules run at error level. None of them can be turned down to a warning through `layout()`.

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
| `no-ownerless-files` | A file or folder named after one of `ownerlessNames`, anywhere under `appsDir` or `packagesDir`, or after one of `mechanismNames` inside a package. Name the file after what it owns instead. |
| `package-root-files` | A file directly in `<package>/src/` that is not one of `packageRootFiles`. Folders are fine: they are subject folders, `adapters/`, or `tests/`. Test files are left to the test rules. |
| `domain-does-not-import-adapters` | A file under `<package>/src/` that imports the package's own `adaptersDir`, unless it is the `publicEntry`, the `facadeFile`, or itself under `adaptersDir`. Tests outside `adaptersDir` count too. Another package's adapters are already closed by `packages-public-entry-only`. |
| `subjects-do-not-import-package-root` | A file in a subject folder that imports its own package's `publicEntry` or `facadeFile`. Those barrels re-export every subject, so a cycle through one, such as `a/one.ts -> index.ts -> b/id.ts` with `b/two.ts -> a/id.ts`, is no file cycle and no folder cycle. `storage.ts`, `adaptersDir` and the test folders may still import them. Its own rule, not part of `no-subject-folder-cycles`, because that is a folder rule and this one names a file. See [Package layout](#package-layout). |
| `no-subject-folder-cycles` | Two subject folders of one package that import each other, directly or around a longer loop, even when no file-level cycle exists. A folder rule; see [Package layout](#package-layout). |
| `adapter-imports-only-in-adapters` | A file under `<package>/src/`, outside `adaptersDir` and outside the `adapterPackages`, that imports one of `adapterImports`. A module's domain code talks to its storage port; the SQL lives in its adapters. Tests outside `adaptersDir` count too: run store tests from `src/adapters/tests/`. A package may import its own files, even when `adapterImports` names it; the exception names that package's folder exactly. Apps are not checked, so a server may import `@effect/platform-node`. Several rules share this name, so select them with `filter`, not `find`; see [Adapter imports](#adapter-imports). |

A deep import that does not resolve fires both `no-unresolved-deep-package-imports` and `no-unresolved-imports`. That is intended: the first names the cause.

`tests-live-in-tests-dir`, `app-code-in-layers`, `no-ownerless-files` and `package-root-files` are module rules, so they report the file itself. A dependency rule would miss a test that imports nothing. Dependency Cruiser has no plain "every module" condition, so the rule uses `numberOfDependentsLessThan: 100`, which every file meets. Module rules see only files Dependency Cruiser parses: JS and TS files. A `utils/` folder that holds only CSS or JSON goes unreported.

## Dependency Cruiser options

The returned `options` block:

- parses with SWC (`parser: "swc"`). Install `@swc/core` for that. Without it, Dependency Cruiser falls back to its other parsers.
- skips `dist`, `coverage`, `generated`, `.turbo`, and `.agent_sources` folders outside `node_modules`. It does not follow `node_modules`, but keeps the packages a file imports in the graph, so `adapter-imports-only-in-adapters` can match their resolved paths, such as `node_modules/.pnpm/effect@<v>/node_modules/effect/dist/unstable/sql/SqlClient.js`. A project that adds `node_modules` to `exclude` turns that rule off.
- sets `skipAnalysisNotInRules: true` and `tsPreCompilationDeps: "specify"`.
- resolves packages through their `exports` field, with the `import`, `require`, `node`, and `default` conditions.

## Package layout

A package lays its code out as subject folders, one per subject, even when it has one. A subject folder is a folder directly under `<package>/src/`, other than `adaptersDir` and the test folders. Five rules hold the shape:

```text
packages/trips/src/
  index.ts  facade.ts  storage.ts     package-root-files: nothing else loose here
  trip/      trip.ts item-errors.ts   the root subject, the shared kernel
  places/    place.ts                 no-ownerless-files: no types.ts, errors/, validation.ts
  items/     item.ts
  adapters/  postgres/ memory/ tests/ domain-does-not-import-adapters: only index.ts and facade.ts reach in

  trip/ <── places/ <── items/ <── facade.ts <── index.ts      no-subject-folder-cycles: one direction
                                                               subjects-do-not-import-package-root: no arrow back to facade.ts or index.ts
```

`no-subject-folder-cycles` is a Dependency Cruiser folder rule (`scope: "folder"`, supported by the pinned 18.4.0). Dependency Cruiser rolls each module up into every folder above it and records a dependency from a folder to the folder of each file it imports outside itself. The rule reports a dependency from one subject folder, or a folder inside it, to another subject folder of the same package when that dependency sits on a cycle. So `places/place.ts -> items/item-ref.ts` and `items/item.ts -> places/place-id.ts` fail together, though no file imports itself back. A path through a root file such as `storage.ts` is not a subject-folder edge, because `src/` holds every subject. A folder rule makes Dependency Cruiser compute folder metrics for the whole run, which costs a little time.

That folder rule cannot see a cycle that runs through the package's own barrel: `a/one.ts -> index.ts -> b/id.ts` and `b/two.ts -> a/id.ts` close no file loop, and `index.ts` sits in `src/`, not in a subject folder. `subjects-do-not-import-package-root` closes the hole by banning the first edge: a subject file imports another subject directly. It leaves `storage.ts` alone, because the storage port holds no subject code.

Adapters mirror the subjects: `adapters/<kind>/<subject>.ts` holds that subject's SQL or memory code. No rule checks it; a reviewer does.

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
