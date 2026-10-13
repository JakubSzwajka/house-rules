# Dependency Cruiser layout preset

Import path: `@house-rules/rules/dependency-cruiser`

This preset is not an ESLint preset. It is a [Dependency Cruiser](https://github.com/sverweij/dependency-cruiser) configuration for a workspace monorepo with apps under `apps/` and packages under `packages/`. The `layout(options)` factory returns a whole config object, `forbidden` rules and `options` together, that a `.dependency-cruiser.cjs` file can export as-is. `tests/fixtures/dependency-cruiser/layout-hosti.snapshot.json` is a snapshot of `layout({ scope: "@hosti/" })`, and a test compares them. The first 13 rules are drunk-cat-stack's hand-written `.dependency-cruiser.cjs` from before 0.4.0. Version 0.4.0 adds three rules, 0.7.0 adds `adapter-imports-only-in-adapters` and keeps `node_modules` in the graph, 0.8.0 runs that rule at error and lets `adapterImports` name workspace packages, and 0.10.0 adds the package layout rules (`package-root-files`, `domain-does-not-import-adapters`, `subjects-do-not-import-package-root`, and mechanism names in `no-ownerless-files`). Version 0.11.0 adds `no-package-cycles` to the separate `house-rules-layout` bin. `no-subject-folder-cycles` also runs there, so the Dependency Cruiser rule set still contains 20 named rules. Version 0.12.0 adds the `serverEntryFiles` and `generatedDeclarationFiles` options for web apps; both default to `[]`, which leaves the config byte-identical to 0.11.0. See [Web apps](#web-apps). Version 0.14.0 adds `contract-entry-is-browser-safe` and its `trustedContractPackages` option, and lets a package declare one more entry, `src/contract.ts`, so the config holds 21 named rules. See [Contract entry](#contract-entry). Version 0.15.0 trusts an installed contract entry in its built form, `dist/contract.js`, as the registry ships it, and `house-rules-layout` checks `publishConfig.exports` too. Version 0.16.0 is breaking. It adds the composition layer, `src/composition/`, with two rules, `composition-imports-packages-only` and `use-cases-do-not-import-composition`, so the config holds 23 named rules. It removes `serverEntryFiles`, and adds an opt-in host preset, `layout({ host: "next" })`. Without `host`, the config differs from 0.15.0 by the composition layer, the removed `serverEntryFiles`, and five rules that now follow reachability: `delivery-does-not-import-server`, `server-does-not-import-delivery`, `use-cases-do-not-import-outer-layers`, `composition-imports-packages-only` and `use-cases-do-not-import-composition`. See [Composition](#composition), [Web apps](#web-apps) and [Upgrading to 0.16.0](#upgrading-to-0160). Version 0.16.1 fixes the host's entry files: with `host` set and `appEntryFiles` not given, `src/main.ts` and `src/index.ts` are no longer allowed in a host app, which has only its host's entry files. An app that keeps one names it in `appEntryFiles`.

```js
// .dependency-cruiser.cjs
module.exports = require("@house-rules/rules/dependency-cruiser").layout({ scope: "@acme/" });
```

Run it with the Dependency Cruiser CLI:

```sh
npx depcruise --config .dependency-cruiser.cjs apps packages
```

The file is CommonJS and loads only its three sibling files in the same folder, `layout-option-parsers.cjs`, `layout-patterns.cjs` and `hosts.cjs`, which ship with it. It exports `layout` and `DEFAULT_ADAPTER_IMPORTS`, the default `adapterImports` list. `require()` and `import` both work, and neither loads ESLint, `@eslint/css`, `@eslint/markdown`, or anything from `node_modules`. Dependency Cruiser is an optional peer dependency (`^18.4.0`), so install it yourself:

```sh
npm install --save-dev --save-exact dependency-cruiser@18.4.0
```

Since 0.16.2, stable Effect paths get the same rules as their RC paths: `effect/sql` is adapter-only, and `effect/http` is browser-allowlisted. The RC paths remain checked so a rules upgrade does not weaken an older app's fence.

## Expected layout

```text
apps/<app>/src/delivery/       delivery layer
apps/<app>/src/server/         server layer
apps/<app>/src/use-cases/      use-cases layer, one use-case per top-level entry
apps/<app>/src/composition/    composition layer: the one composition root, its callers and views
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
| `layers.composition` | `"composition"` | Composition folder under `<app>/src/`: the app's one composition root. Since 0.16.0. See [Composition](#composition). |
| `host` | none | A host preset that names its framework's files, so the app names none of them. `"next"` is the only host. Leaving it out changes nothing. See [Web apps](#web-apps). |
| `publicEntry` | `"src/index.ts"` | The only file of a package that another workspace may import. |
| `internalDir` | `"src/internal"` | Private package code that tests may not import. Subject folders replace it; see [Package layout](#package-layout). |
| `appEntryFiles` | `["main.ts", "index.ts"]`, or `[]` with a `host` | File names that may sit directly in `<app>/src/`. Names, not paths. `[]` allows none. A `host` adds its own entry files to this list. With a `host` and no `appEntryFiles`, the default is `[]`, so only the host's entry files may sit there. |
| `ownerlessNames` | `["utils", "helpers", "misc"]` | File and folder names that `no-ownerless-files` rejects. A name matches `utils.ts`, `utils.test.ts`, `utils/`, but not `string-utils.ts` or `utilities.ts`. Must not be empty. |
| `mechanismNames` | `["types", "models", "schemas", "drafts", "errors", "validate", "validation", "constants", "interfaces", "internal"]` | File and folder names that `no-ownerless-files` rejects inside a package under `packagesDir`, not in apps. Matched by whole name, like `ownerlessNames`, so `item-errors.ts` passes, and in any letter case, so `Types.ts` and `Errors/` fail. (`ownerlessNames` stay case-sensitive.) Replaces the default list. `[]` turns the check off. |
| `packageRootFiles` | `["index.ts", "facade.ts", "storage.ts"]` | File names that may sit directly in `<package>/src/`. Names, not paths. Must not be empty. |
| `facadeFile` | `"src/facade.ts"` | The package file that may import the package's own `adaptersDir`, next to `publicEntry`. |
| `adaptersDir` | `"src/adapters"` | Package code that may import `adapterImports`. Tests under it may too. |
| `adapterImports` | `DEFAULT_ADAPTER_IMPORTS`: `["effect/unstable/sql", "effect/sql", "@effect/sql-*", "@effect/platform-*"]` | Bare import specifiers that only adapter code may import. A `*` matches within one path segment. An entry in `scope`, such as `"@acme/db"`, names a workspace package too. Replaces the default list, so spread `DEFAULT_ADAPTER_IMPORTS` to add to it. Must not be empty. A scoped glob exempts every matching sibling's own folder; see [Adapter imports](#adapter-imports). |
| `adapterPackages` | `[]` | Package folder names under `packagesDir` that are adapters by nature, such as plumbing (`"db"`) or the migration runner (`"migrations"`). Every file in them may import `adapterImports`. Names, not paths. |
| `generatedDeclarationFiles` | `[]` | Declaration files a framework generates, such as `"vite-env.d.ts"`, whose imports `no-unresolved-imports` skips. Paths relative to each app folder, each ending in `.d.ts`, `.d.mts` or `.d.cts`. A `host` adds its own, such as Next's `next-env.d.ts`. See [Web apps](#web-apps). |
| `trustedContractPackages` | `[]` | Installed packages whose `./contract` entry (`src/contract.ts`, or its build `dist/contract.js`) a contract entry may import. `@house-rules/capability` is always trusted. You vouch for each name: the rule cannot look inside `node_modules`. See [Contract entry](#contract-entry). |
| `testsDir` | `"tests"` | Name of the folder every test file must sit in directly, somewhere under `<workspace>/src/`. It also counts as a test path for `production-does-not-import-tests`, next to `test`, `tests`, and `__tests__`. |

Option values are folder names and paths, not regular expressions. The factory escapes them. Each layer root ends in `(?:/|$)`, so `delivery-legacy` is not `delivery`. An unknown option or layer name throws, and so does a path that is empty or starts or ends with `/`. `adapterImportsSeverity` was removed in 0.8.0. Passing it throws, because `adapter-imports-only-in-adapters` is always an error: a repo that breaks it fixes the imports by hand. `serverEntryFiles` was removed in 0.16.0. Passing it throws too, even as `[]`, and the error says what replaces it: see [Upgrading to 0.16.0](#upgrading-to-0160). An unknown `host` throws and names the known hosts.

## Rules

Each rule carries a `comment` with `See https://stack.kubaszwajka.com/rules/#<rule name>`, which only the `err-long` reporter prints under a violation. The default `err` reporter omits it, so run `depcruise --output-type err-long`, as the root `deps` script does. All 23 named Dependency Cruiser rules run at error level. None can be turned down to a warning through `layout()`. `no-subject-folder-cycles` and `no-package-cycles` run separately through the `house-rules-layout` bin.

| Rule | Reports |
| --- | --- |
| `no-cycles` | Any import cycle. |
| `packages-do-not-import-apps` | A package importing app code. |
| `apps-do-not-import-other-apps` | An app importing another app. |
| `packages-imported-by-name` | A relative-path import into another package. Import it by its package name. |
| `packages-public-entry-only` | Another workspace reaching a package file other than its `publicEntry` or its contract entry, `src/contract.ts`. |
| `contract-entry-is-browser-safe` | A package's `src/contract.ts` that reaches, directly or through other files, anything outside the browser-safe set. Always on, at error; `trustedContractPackages` only adds installed contract entries you vouch for. See [Contract entry](#contract-entry). |
| `delivery-does-not-import-server` | Delivery code reaching server code, directly or through any other file, such as `src/index.ts` re-exporting it. No option opens it: delivery reaches the app's services through `composition/` and the delivery adapters. See [Reachability](#reachability). |
| `server-does-not-import-delivery` | Server code reaching delivery code, directly or through any other file. |
| `use-cases-do-not-import-outer-layers` | Use-cases code reaching delivery or server code, directly or through any other file. |
| `composition-imports-packages-only` | A file under `<app>/src/composition/` importing any app file outside `composition/`: delivery, server, a use-case, an entry file. Its tests count too. Packages and installed modules are fine. See [Composition](#composition). |
| `use-cases-do-not-import-composition` | A use-case reaching `composition/`, directly or through any other file. A use-case's test may import it, to share the app's layers. See [Composition](#composition). |
| `no-unresolved-deep-package-imports` | An unresolved deep import such as `@acme/bookings/internal/x`. |
| `production-does-not-import-tests` | Source code under `src/` importing a test file or anything in a test folder. |
| `no-unresolved-imports` | Any import that does not resolve, including a workspace package the importer does not declare. |
| `tests-live-in-tests-dir` | A `*.test.*` or `*.spec.*` file in a workspace that does not sit directly in a `testsDir` folder under `src/`. A package-root `tests/`, a subfolder of `tests/`, and `unit-tests/` all fail. |
| `tests-do-not-import-internals` | A test file, or a file in a test folder, importing `packages/<pkg>/src/internal/`. Test through the public entry. |
| `app-code-in-layers` | A file under `<app>/src/` outside the four layer folders (delivery, server, use-cases, composition), unless it is an `appEntryFiles` file directly in `src/`. Test files and files in test folders are left to the test rules. |
| `use-cases-do-not-import-use-cases` | A use-case reaching another use-case, directly or through any other file. A use-case is one top-level entry under `use-cases/`: a file, or a folder with everything in it. Imports inside one entry are fine. Test files are never the importer, and a test path is never the target. |
| `no-ownerless-files` | A file or folder named after one of `ownerlessNames`, anywhere under `appsDir` or `packagesDir`, or after one of `mechanismNames` inside a package. Name the file after what it owns instead. |
| `package-root-files` | A file directly in `<package>/src/` that is not one of `packageRootFiles` or `contract.ts`. Folders are fine: they are subject folders, `adapters/`, or `tests/`. Test files are left to the test rules. |
| `domain-does-not-import-adapters` | Package code may import its own `adaptersDir` only from the `publicEntry`, `facadeFile`, or within `adaptersDir`; test files may also import `adaptersDir/tests/`, but no other domain file may. Tests still cannot import adapter production code under `adaptersDir`. Another package's adapters are already closed by `packages-public-entry-only`. Several rules share this name, so select them with `filter`, not `find`. |
| `subjects-do-not-import-package-root` | A file in a subject folder that imports its own package's `publicEntry`, `facadeFile` or `src/contract.ts`. Those barrels re-export every subject, so a cycle through one, such as `a/one.ts -> index.ts -> b/id.ts` with `b/two.ts -> a/id.ts`, is no file cycle and no subject-folder cycle. `storage.ts`, `adaptersDir` and the test folders may still import them. This dependency rule names a file; `no-subject-folder-cycles` checks direct subject-to-subject imports. See [Package layout](#package-layout). |
| `no-subject-folder-cycles` | Subject folders of one package importing each other in a cycle, even when no file-level cycle exists. Test paths do not contribute edges. A Node check; see [Package layout](#package-layout). |
| `no-package-cycles` | Workspace packages importing each other in a production cycle. Test paths do not contribute edges. A Node check; see [Package layout](#package-layout). |
| `adapter-imports-only-in-adapters` | A file under `<package>/src/`, outside `adaptersDir` and outside the `adapterPackages`, that imports one of `adapterImports`. A module's domain code talks to its storage port; the SQL lives in its adapters. Tests outside `adaptersDir` count too: run store tests from `src/adapters/tests/`. A package may import its own files, even when `adapterImports` names it; the exception names that package's folder exactly. Apps are not checked, so a server may import `@effect/platform-node`. Several rules share this name, so select them with `filter`, not `find`; see [Adapter imports](#adapter-imports). |

### Reachability

Entry files, such as `src/main.ts`, `src/index.ts` and a host's `proxy.ts`, may import every layer. So a direct-import check has a bridge: `delivery/route.ts -> src/index.ts -> server/runtime.ts` imports no server file, yet runs one. The five layer rules above therefore set `reachable: true`. They report every forbidden file the importer reaches through any chain of imports, whatever sits in between: an entry file, a file beside `src/`, or one not yet thought of. Banning imports of entry files would close only the bridges someone listed.

A valid app never has such a path. Composition imports no app file, a use-case imports only its own entry and packages, and packages never import apps. So delivery reaches use-cases, composition and packages, and never the server; `main.ts` still wires all four. A report lists each forbidden file the importer reaches, so one bad import can give several lines. `tests/fixtures/dependency-cruiser/bridges/` holds one app per bridge.

A deep import that does not resolve fires both `no-unresolved-deep-package-imports` and `no-unresolved-imports`. That is intended: the first names the cause.

`tests-live-in-tests-dir`, `app-code-in-layers`, `no-ownerless-files` and `package-root-files` are module rules, so they report the file itself. A dependency rule would miss a test that imports nothing. Dependency Cruiser has no plain "every module" condition, so the rule uses `numberOfDependentsLessThan: 100`, which every file meets. Module rules see only files Dependency Cruiser parses: JS and TS files. A `utils/` folder that holds only CSS or JSON goes unreported.

## Dependency Cruiser options

The returned `options` block:

- parses with SWC (`parser: "swc"`). Install `@swc/core` for that. Without it, Dependency Cruiser falls back to its other parsers.
- skips `dist`, `coverage`, `generated`, `.turbo`, and `.agent_sources` folders outside `node_modules`. It does not follow `node_modules`, but keeps the packages a file imports in the graph, so `adapter-imports-only-in-adapters` can match their resolved paths, such as `node_modules/.pnpm/effect@<v>/node_modules/effect/dist/sql/SqlClient.js`. A project that adds `node_modules` to `exclude` turns that rule off.
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
  adapters/  postgres/ memory/ tests/ domain-does-not-import-adapters: index.ts and facade.ts reach in; tests may reach adapters/tests/

  trip/ <── places/ <── items/ <── facade.ts <── index.ts      no-subject-folder-cycles: one direction
                                                               subjects-do-not-import-package-root: no arrow back to facade.ts or index.ts
```

`no-subject-folder-cycles` and `no-package-cycles` run in the `house-rules-layout` Node bin, not as Dependency Cruiser rules. Dependency Cruiser 18.4.0 computes folder cycles from all files and its folder-scope matcher cannot filter test paths inside a cycle. When a check fails, the bin ends its report with `See https://stack.kubaszwajka.com/rules/#no-subject-folder-cycles` or `#no-package-cycles`, one line for each failing check. The bin uses the same `.dependency-cruiser.cjs` config and cruises the workspace once. It builds one graph from production imports between subject folders in each package, then another from production imports between packages. Subject edges skip paths matching the shared test-path pattern, `adaptersDir`, and loose files directly under `src/`. Package edges skip test paths, both as importers and targets. A test-only route through `src/tests/` or `adapters/tests/` adds no subject edges; test files never add package edges. Production subject imports count, including cycles split across files, such as `places/place.ts -> items/item-ref.ts` and `items/item.ts -> places/place-id.ts`. A path through a root file such as `storage.ts` is not a subject edge, because `src/` holds every subject. A name such as `tests-utils` is not a test path: the pattern matches `test`, `tests`, and `__tests__` directory segments, plus filenames ending in `.test.*` or `.spec.*`.

Each reported folder-to-folder edge includes one example import, from the importing file to its dependency. The subject-folder check cannot see a cycle that runs through the package's own barrel: `a/one.ts -> index.ts -> b/id.ts` and `b/two.ts -> a/id.ts`, because `index.ts` sits directly in `src/`, not in a subject folder. `subjects-do-not-import-package-root` closes the hole by banning the first edge: a subject file imports another subject directly. It leaves `storage.ts` alone, because the storage port holds no subject code.

`no-package-cycles` uses package names from workspace manifests and records one example import per package edge. It catches cycles that the file-level `no-cycles` rule cannot see. For example, package A's `feature/x.ts` can import B, while B's `feature/y.ts` imports A's public entry. If A's entry exports `feature/z.ts` instead of `feature/x.ts`, the file graph has no cycle, but the package graph has `@acme/a -> @acme/b -> @acme/a`. A package may use another package only through its public entry and service. The graph has no required levels. Packages never read one another's tables or SQL.

Adapters mirror the subjects: `adapters/<kind>/<subject>.ts` holds that subject's SQL or memory code. Tests may import support files under `adapters/tests/`, but may not import adapter production code such as `adapters/postgres/` or `adapters/memory/`; domain files may import neither. No rule checks the subject-to-adapter mirror; a reviewer does.

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

## Composition

An app keeps its one composition root in `src/composition/`: the app layer, `composition({ layer, caller, views })` from `@house-rules/capability`, its callers and its views. Everything else reaches the app's services through it.

```text
apps/<app>/src/
  composition/   app = composition({ layer, caller, views }); callers; views
  use-cases/     capabilities
  delivery/      routes, MCP, pages (Next.js keeps src/app/ as its delivery folder)
  server/        background loops
  main.ts        Node Host call, an appEntryFiles entry

  delivery ──> composition <── server          composition ──> packages only
  tests    ──> composition                     use-cases ─X─> composition
```

- `composition-imports-packages-only`: the composition imports packages and installed modules only, never another app file. It cannot reach a route, a server loop or a use-case, so wiring never depends on what it wires. Its own tests follow the rule too; a test that needs a use-case and the composition sits in `src/tests/` or `use-cases/tests/`.
- `use-cases-do-not-import-composition`: a use-case yields services and never picks their layers. Its test may import `composition/`, so use-case tests share the app's layers instead of copying them.
- Delivery, server and every test may import `composition/`. `app-code-in-layers` counts `composition/` as a layer.

A plain Node app calls `serve` from `@house-rules/node-host` in `src/main.ts`, an `appEntryFiles` entry. It joins the delivery fetch handler and the composition, with `onClose: () => api.dispose().then(() => app.dispose())`. `src/server/` holds background loops, not the Host call. The Node Host uses the strict TypeScript preset; Effect apps keep `nodeBuiltinImport: error`. A Next app already has a Host and does not need the Node Host package.

`layers.composition` renames the folder. `tests/fixtures/dependency-cruiser/node-app/` is a plain Node app with a composition folder and no host, and it passes with no option.

## Web apps

A web framework, such as Next.js, Remix or Astro, runs pages and routes in the delivery layer. A page reaches a use-case through `composition/` and the delivery adapters: `call(app, capability, input, incoming)` for server components, `toFetchHandler` for routes, `toMcpHandler` for MCP. It never imports the server folder.

`generatedDeclarationFiles` names declaration files the framework writes, which import build output that does not exist before a build. `no-unresolved-imports` skips imports from those exact files, and only that rule. Paths are matched exactly, so `next-env.d.ts` does not cover `src/next-env.d.ts`. `tests/fixtures/dependency-cruiser/web-app/` is the fixture.

### The Next.js host

`layout({ host: "next" })` knows Next's own files, so a Next app sets no option or exclude for them:

| Next file | What the host does | Bend it replaces |
| --- | --- | --- |
| `src/app/` | The delivery folder: `layers.delivery` defaults to `"app"`. An app's own `layers.delivery` still wins. | `layers: { delivery: "app" }` |
| `src/proxy.ts`, `src/instrumentation.ts` | Entry files, added to the app's `appEntryFiles`. Since 0.16.1, they are the only entry files unless the app names more: the generic `main.ts` and `index.ts` defaults are left out, because Next runs neither. | `appEntryFiles: ["proxy.ts", "instrumentation.ts"]` |
| `next-env.d.ts` | A generated declaration file, added to the app's `generatedDeclarationFiles`. | `generatedDeclarationFiles: ["next-env.d.ts"]` |
| `.next/` | Build output, added to `options.exclude` next to `dist` and `coverage`. | A hand-edited `exclude` |

```js
// .dependency-cruiser.cjs, a Next.js app at apps/web
module.exports = require("@house-rules/rules/dependency-cruiser").layout({
  scope: "@acme/",
  host: "next",
});
```

The host changes nothing else: every rule keeps its name, its order and its shape, apart from the folder, file and exclude patterns above. `tests/fixtures/dependency-cruiser/layout-hosti-next.snapshot.json` is a snapshot of `layout({ scope: "@hosti/", host: "next" })`, and `tests/fixtures/dependency-cruiser/next-app/` is a Next-shaped app that fails six times without the host and passes with it. `appEntryFiles` and `generatedDeclarationFiles` stay general options for other hosts, such as a Vite app's `vite-env.d.ts`. The same host name turns on the ESLint side in `shadcn({ host: "next" })`, see `shadcn.md`; `configs.nextHost` from the package root makes ESLint ignore `.next/` and `next-env.d.ts`; and the TypeScript side is `tsconfig/next.json`, see [tsconfig.md](tsconfig.md#nextjson).

## Upgrading to 0.16.0

0.16.0 removes `serverEntryFiles`. Passing it throws:

```text
layout(): serverEntryFiles was removed in 0.16.0. Delivery no longer imports a server runtime. ...
```

1. [ ] Move the app layer, the callers and the views into `src/composition/`, and export `app = composition({ layer, caller, views })` from `@house-rules/capability`. The composition may import packages only.
2. [ ] Replace each page or route that ran a use-case on the server runtime with a delivery adapter over `app`: `call` in a server component or server action, `toFetchHandler` for HTTP routes, `toMcpHandler` for MCP.
3. [ ] Delete the runtime file from `src/server/`, and drop `serverEntryFiles` from `layout()`.
4. [ ] Move shared test layers, such as identity-backed holders, into `composition/`; use-case tests may import it.
5. [ ] A Next.js app: replace `layers: { delivery: "app" }`, the Next entry files, `next-env.d.ts` and the `.next` exclude with `host: "next"`, and extend `tsconfig/next.json`.

For an app without `host`, two other things differ from 0.15.0. The composition layer is new, and an app without `src/composition/` never meets it. The five layer rules now follow reachability, see [Reachability](#reachability): a layer that reached a forbidden layer through `src/index.ts` or another file passed before and fails now. Remove the bridge import; it is a bug the old check missed.

## Adapter imports

`adapter-imports-only-in-adapters` matches each import by its resolved path under `node_modules`. `effect/sql` becomes `(?:^|/)node_modules/effect/(?:[^/]+/|)sql(?:[/.]|$)`: the subpath may sit one folder down, such as `dist/`, as `exports` maps usually put it. A specifier with no subpath, such as `@effect/sql-*`, matches the whole package. An import that does not resolve is left to `no-unresolved-imports`.

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

## Contract entry

A package may declare one second entry, `src/contract.ts`, as `"./contract"` in its `exports`, and everything that file reaches must load in a browser.

`packages-public-entry-only` lets another workspace import exactly that file, `package-root-files` allows it, and `subjects-do-not-import-package-root` treats it as a barrel. `contract-entry-is-browser-safe` follows every import from it, type-only ones too, and reports any module outside this set:

| Allowed | Pattern |
| --- | --- |
| A workspace package's files under `src/` | not `adaptersDir`, not `publicEntry`, `facadeFile` or `src/storage.ts`, not a test path. This includes another workspace package's `src/contract.ts`, which the rule follows too. |
| An `effect` module on the allowlist | the root `effect`, a stable top-level module such as `effect/Schema`, and `effect/http` with its modules, or its RC path `effect/unstable/http`. Nothing else from `effect`: not `effect/sql`, `effect/process`, or `effect/persistence/PersistedQueue`, nor their RC paths. |
| A trusted installed contract entry | `src/contract.ts`, or its build `dist/contract.js` and `dist/contract.d.ts`, of `@house-rules/capability`, and of each package named in the `trustedContractPackages` option, which defaults to `[]`. A git dependency installs the source file; the npm registry installs the build. |

So a contract entry that reaches `node:fs`, `pg`, `@effect/sql-pg`, its own `facade.ts`, another package's `index.ts`, or an installed contract entry no one vouched for fails.

The rule is always on, at error. Its one option, `trustedContractPackages`, names installed packages whose `./contract` entry you vouch for. Use it only for a package whose own repo runs this rule on that entry and bundles it for a browser.

What it cannot see:

- **Inside `node_modules`.** The config never follows an installed package, so whatever an allowlisted `effect` module or a trusted contract entry imports goes unchecked. That is why both lists are short and named. `@house-rules/capability`'s entry is checked as a workspace file in this repo. The stack's `apps/api/src/tests/browser-bundle.test.ts` bundles every allowlisted `effect` module with esbuild for the browser and fails if SQL or process code ships. Re-run it when you bump `effect`.
- **A computed import.** `import(at)` leaves no edge in the graph. The ESLint rule `no-computed-import` (`docs/no-computed-import.md`) fails it in every package's source. With another `packagesDir`, build the ESLint preset with `capabilityConfig({ packagesDir })` so it covers the same folder.
- **The manifest.** The rule matches the resolved file, not the `exports` key. `house-rules-layout` reads every package's `package.json`. It fails any exports key but `.` and `./contract`, a pattern such as `./browser/*` included, since a pattern reaches every file under `src/`. It also fails a target, a condition's too, that is not that key's file or its build: `publicEntry` for `.`, `src/contract.ts` for `./contract`, and for `src/x.ts` the build is `dist/x.js` or `dist/x.d.ts`. It checks `publishConfig.exports` the same way, because pnpm puts that field in place of `exports` in the published manifest. A package the config's `options.exclude.path` excludes, such as the stack's `packages/rules`, is skipped.
