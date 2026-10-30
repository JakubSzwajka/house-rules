# @house-rules/rules

House rules and presets for TypeScript workspaces. Version 0.19.0. Install every dependency at an exact version. This package ships checked-in JavaScript with no build step.

## Install and enable

The root entry needs ESLint 10.11.0 and supplies its own TypeScript parser. Optional subpaths load their peers only when used: markdown uses @eslint/markdown 8.0.3; design uses @eslint/css 2.0.0; shadcn uses @shadcn/lint 0.2.0; dependency-cruiser uses 18.4.0. Biome uses 2.5.14. Keep the consumer's runtime and compiler pins as declared by its package.json.

```js
import houseRules, { featuresConfig } from "@house-rules/rules";
export default [
  ...houseRules.configs.recommended,
  ...featuresConfig({ appsDir: ["apps", "examples/*/apps"], packagesDir: "packages" }),
];
```

`configs.features` is the default-root form. There is no compatibility alias. It preserves no-hand-rolled-surface on JS/TS, no-hand-run-effect on tests, testing-exports-only-in-tests on JS/TS and no-computed-import on production package/app source. The feature rule checks feature/read-model indexes, matching builders, sibling files and registry values. New SQL/service query infrastructure lives in projections/; the SQL checker scans projections and legacy read-model folders with the same grammar. The default recommended preset rejects read-only defineFeature authoring through command-kind at error, without feature-preset opt-in. Use defineReadModel for queries; runtime legacy compatibility remains. Legacy mount kind read-model still denotes a projection; it never classifies an exposed query. Builder provenance also checks production JS/TS workspace packages through packagesDir; only domain/application kit implementations, tests and top-level tooling are exempt. Pass the same roots to `layout()` and `featuresConfig()`.

## App map source facts

`appMapSources(snapshot, { appDirectory, rootDirectory, packageRoots })` from `@house-rules/rules/app-map` adds paths and owners to an application app map. Use it in tooling only. It reads direct named Features/ReadModels registry imports, literal defineFeature/defineReadModel/defineOperation/defineWay names and package manifests. Import renames are supported. Missing, computed or ambiguous facts fail instead of producing a guessed path. Missing `src/read-models` and `src/ways-in` directories count as empty. Pass workspace package roots relative to rootDirectory; output paths are app-relative for app code and repo-relative for packages. Workspace modules are located from source as before. Installed `@house-rules/*` mounts outside the workspace package roots use their package identity and installed manifest, without requiring TypeScript source. The returned module object includes the manifest's `version`; rendered maps do not show it. This helper does not extract layout directions. Pair it with application's `appMap` and pure `renderMap` in the app map script to write `MAP.md`. The freshness test compares without writing.

## Rules and checks

Each rule id is a stable docs anchor. Change source, tests, docs and this table together, then run `pnpm --filter @house-rules/site generate` in the stack repository.

| Rule | Catches | Tool | Enable via | Docs |
| --- | --- | --- | --- | --- |
| `comment-discipline` | Top-level narrative, multiline comments and adjacent groups; keeps one-line whys beside code | ESLint | `configs.recommended` | [comment-discipline.md](docs/comment-discipline.md) |
| `command-kind` | readOnly true commands, indirect/mixed builder wrappers, finished commands from exempt tests/tooling (including star/namespace aggregates), every nonliteral dynamic import in production src, nonliteral require, literal loading of modules containing finished features or builder wrappers, and unresolved, spread, computed, accessor, method, duplicate or __proto__ options/flags; requires direct named imports, inline options and literal boolean flags | ESLint | `configs.recommended` | [command-kind.md](docs/command-kind.md) |
| `no-broken-relative-links` | Relative Markdown links to missing, ignored, outside-repository or non-file targets | ESLint | `@house-rules/rules/markdown` | [no-broken-relative-links.md](docs/no-broken-relative-links.md) |
| `design-no-raw-color` | Raw colours in CSS | ESLint | `design()` | [design-no-raw-color.md](docs/design-no-raw-color.md) |
| `design-no-raw-color-literal` | Raw colours in JS/TS strings | ESLint | `design()` | [design-no-raw-color-literal.md](docs/design-no-raw-color-literal.md) |
| `design-no-unknown-token` | CSS custom properties without definitions | ESLint | `design()` | [design-no-unknown-token.md](docs/design-no-unknown-token.md) |
| `design-scale-value` | CSS values off an allowed scale | ESLint | `design()` | [design-scale-value.md](docs/design-scale-value.md) |
| `design-css-layers` | Styles outside allowed layers, restricted-layer violations and important | ESLint | `design()` | `docs/design-css-layers.md` |
| `design-no-raw-element` | Raw JSX elements where a design-system component exists | ESLint | `shadcn()` | `docs/design-no-raw-element.md` |
| `shadcn/*` (six rules from `@shadcn/lint`) | Restyling, palette colours, arbitrary values, inline styles, dynamic classes and unknown classes | ESLint | `shadcn()` | `docs/shadcn.md` |
| `feature-file` | Wrong-kind entry folders, extra files, indirect/multiple defineFeature or defineReadModel calls, non-contract imports and registry values beyond Features/ReadModels | ESLint | `configs.features` | [feature-file.md](docs/feature-file.md) |
| `feature-builders` | Read-model edges into writes or unknown/dynamic operation origins, wrong-kind builders, non-inline or ambiguous options, exposures or starts (including defineWay.public, resolved hook/schedule/event protocols and system-start features, May.context and May.system) without app feature origins, feature builders outside feature indexes, operation builders inside features, indirect kit builders, forbidden package feature/way/endpoint imports, kit-builder re-exports and CommonJS builder loaders | ESLint | `configs.features` | [feature-builders.md](docs/feature-builders.md) |
| `esm-only-effect` | CommonJS loading in production app and Effect workspace-package src, including kits | ESLint | `configs.features` | [esm-only-effect.md](docs/esm-only-effect.md) |
| `no-hand-rolled-surface` | Tool.make, Rpc.make and HttpApiEndpoint methods outside application | ESLint | `configs.features` | [no-hand-rolled-surface.md](docs/no-hand-rolled-surface.md) |
| `no-hand-run-effect` | Effect.run* and ManagedRuntime.make in tests | ESLint | `configs.features` | [no-hand-run-effect.md](docs/no-hand-run-effect.md) |
| `no-computed-import` | Computed production imports hiding package/app descriptor graph edges | ESLint | `configs.features` | `docs/no-computed-import.md` |
| `testing-exports-only-in-tests` | Testing exports outside tests or testing-only code; path renames that drop Testing | ESLint | `configs.testing`, `configs.features` | [testing-exports-only-in-tests.md](docs/testing-exports-only-in-tests.md) |
| `no-cycles` | Circular file imports | Dependency Cruiser | `layout({ scope })` | [dependency-cruiser.md](docs/dependency-cruiser.md) |
| `packages-do-not-import-apps` | Packages importing apps | Dependency Cruiser | `layout({ scope })` | [dependency-cruiser.md](docs/dependency-cruiser.md) |
| `apps-do-not-import-other-apps` | Cross-app imports | Dependency Cruiser | `layout({ scope })` | [dependency-cruiser.md](docs/dependency-cruiser.md) |
| `packages-imported-by-name` | Relative cross-package imports | Dependency Cruiser | `layout({ scope })` | [dependency-cruiser.md](docs/dependency-cruiser.md) |
| `packages-public-entry-only` | Deep package imports | Dependency Cruiser | `layout({ scope })` | [dependency-cruiser.md](docs/dependency-cruiser.md) |
| `contract-entry-is-browser-safe` | Package/projection contracts, feature/read-model indexes and registries, and way endpoints.ts reaching server code, storage, facades, adapters or untrusted installed code; invalid package export manifests | Dependency Cruiser | `layout({ scope })`, `house-rules-layout` | [dependency-cruiser.md](docs/dependency-cruiser.md#contract-entry) |
| `domain-imports-no-house-rules` | Framework domain importing any other house-rules package, including type-only application/contract | Dependency Cruiser | `layout({ scope })` | [dependency-cruiser.md](docs/dependency-cruiser.md) |
| `application-does-not-import-event-log` | Application kit importing event-log, including type-only imports; event delivery uses the kit-owned EventSource port | Dependency Cruiser | `layout({ scope })` | [dependency-cruiser.md](docs/dependency-cruiser.md) |
| `features-do-not-import-outer-folders` | Features reaching ways or composition | Dependency Cruiser | `layout({ scope })` | [dependency-cruiser.md](docs/dependency-cruiser.md) |
| `read-models-import-packages-only` | Queries importing app files outside their own folder except projection contracts, and projections importing other app folders | Dependency Cruiser | `layout({ scope })` | [dependency-cruiser.md](docs/dependency-cruiser.md) |
| `ways-in-import-app-folders-only` | Ways importing root entries or other app files, including outside src, as bridges around folder fences | Dependency Cruiser | `layout({ scope })` | [dependency-cruiser.md](docs/dependency-cruiser.md) |
| `ways-in-do-not-import-read-model-values` | Ways importing projection or private read-model values rather than exposed query indexes/registry | Dependency Cruiser | `layout({ scope })` | [dependency-cruiser.md](docs/dependency-cruiser.md) |
| `ways-in-import-contracts-only` | Production ways, including barrels, importing values outside kits, effect, package contracts, own-way files, features or composition; any import, type-only included, of effect/sql, effect/sql/*, effect/unstable/sql or adapterImports; page/** and Next convention/private-folder files also permit third-party npm packages, never workspace mains or adapters | Dependency Cruiser | `layout({ scope })` | [dependency-cruiser.md](docs/dependency-cruiser.md#ways-value-imports) |
| `ways-in-do-not-import-other-ways` | Cross-way imports, including bridges | Dependency Cruiser | `layout({ scope })` | [dependency-cruiser.md](docs/dependency-cruiser.md) |
| `composition-does-not-import-ways-in` | Composition reaching a way, including bridges | Dependency Cruiser | `layout({ scope })` | [dependency-cruiser.md](docs/dependency-cruiser.md#composition) |
| `read-models-public-entry-only` | Outside imports past read-model index.ts and contract.ts doors | Dependency Cruiser | `layout({ scope })` | [dependency-cruiser.md](docs/dependency-cruiser.md) |
| `no-unresolved-deep-package-imports` | Unresolved deep package imports | Dependency Cruiser | `layout({ scope })` | [dependency-cruiser.md](docs/dependency-cruiser.md) |
| `production-does-not-import-tests` | Production imports of tests | Dependency Cruiser | `layout({ scope })` | [dependency-cruiser.md](docs/dependency-cruiser.md) |
| `tests-live-in-tests-dir` | Test files not directly in tests/ | Dependency Cruiser | `layout({ scope })` | [dependency-cruiser.md](docs/dependency-cruiser.md) |
| `tests-do-not-import-internals` | Tests reaching internal directories | Dependency Cruiser | `layout({ scope })` | [dependency-cruiser.md](docs/dependency-cruiser.md) |
| `no-unresolved-imports` | Missing imports, except named generated declarations | Dependency Cruiser | `layout({ scope })` | [dependency-cruiser.md](docs/dependency-cruiser.md) |
| `app-folders` | App code outside features/read-models/projections/ways-in/composition and declared entries | Dependency Cruiser | `layout({ scope })` | [dependency-cruiser.md](docs/dependency-cruiser.md) |
| `no-ownerless-files` | utils/helpers/misc anywhere; caseless mechanism names in packages and read models | Dependency Cruiser | `layout({ scope })` | [dependency-cruiser.md](docs/dependency-cruiser.md#package-layout) |
| `package-root-files` | Loose package/read-model root files except index/facade/storage/contract | Dependency Cruiser | `layout({ scope })` | [dependency-cruiser.md](docs/dependency-cruiser.md#package-layout) |
| `domain-does-not-import-adapters` | Imports of private adapter production code except by the door, facade and adapter code; tests may use adapter test support | Dependency Cruiser | `layout({ scope })` | [dependency-cruiser.md](docs/dependency-cruiser.md#package-layout) |
| `subjects-do-not-import-package-root` | Subject imports of their own index/facade/contract barrel | Dependency Cruiser | `layout({ scope })` | [dependency-cruiser.md](docs/dependency-cruiser.md#package-layout) |
| `no-subject-folder-cycles` | Production subject cycles in packages and read models, excluding tests, adapters and root files | Node | `house-rules-layout` | [dependency-cruiser.md](docs/dependency-cruiser.md#package-layout) |
| `no-package-cycles` | Production package cycles hidden across files | Node | `house-rules-layout` | [dependency-cruiser.md](docs/dependency-cruiser.md#package-layout) |
| `no-app-feature-cycles` | Production cycles between feature folders | Node | `house-rules-layout` | [dependency-cruiser.md](docs/dependency-cruiser.md) |
| `adapter-imports-only-in-adapters` | SQL/driver/platform imports outside package/read-model adapters and named plumbing packages | Dependency Cruiser | `layout({ scope })` | [dependency-cruiser.md](docs/dependency-cruiser.md) |
| Strict compiler flags | strict, unchecked indexes, exact optional properties and other strict flags | TypeScript | `tsconfig/strict.json` | [tsconfig.md](docs/tsconfig.md) |
| Effect diagnostics | Effect diagnostics at error severity | TypeScript | `tsconfig/effect.json` | [tsconfig.md](docs/tsconfig.md) |
| `noReExportAll` | Export-star barrels | Biome | `@house-rules/rules/biome` | [biome.md](docs/biome.md) |
| `noExcessiveLinesPerFile` | Files above 300 lines, warning fails the root check | Biome | `@house-rules/rules/biome` | [biome.md](docs/biome.md) |
| `noNonNullAssertion` | Non-null assertions | Biome | `@house-rules/rules/biome` | [biome.md](docs/biome.md) |
| `useFilenamingConvention` | File names not kebab-case or matching an export | Biome | `@house-rules/rules/biome` | [biome.md](docs/biome.md) |
| Formatter | Two spaces and 100-column formatting | Biome | `@house-rules/rules/biome` | [biome.md](docs/biome.md) |
| Exact pins | Ranges, tags, broad workspace specs and Git refs without full SHAs | Node | `house-rules-pins` | [pins.md](docs/pins.md) |
| `house-rules-migrations` | Cross-module SQL/FKs, invalid view grammar/ownership, missing list entries, duplicate folder identities, symlinked migration directories or SQL files, raw transactions, production app/module-opened units including nested scripts; read-model SQL outside the bounded SELECT/value-parameter grammar | Node | `house-rules-migrations` | [migrations.md](docs/migrations.md) |

## Layout options

```js
const { layout } = require("@house-rules/rules/dependency-cruiser");
module.exports = layout({
  scope: "@example/",
  appsDir: ["apps", "examples/*/apps"],
  packagesDir: "packages",
});
```

Roots are exact relative paths with optional whole `*` segments. Roots must be nonempty and disjoint; arbitrary globs, absolute paths and ambiguous overlaps fail. `layers` accepts only `{ features, readModels, projections, waysIn, composition }`. Defaults are features, read-models, projections, ways-in and composition. Other existing options stay: publicEntry, internalDir, adaptersDir, facadeFile, testsDir, appEntryFiles, ownerlessNames, mechanismNames, packageRootFiles, adapterPackages, adapterImports, generatedDeclarationFiles and trustedContractPackages. No severity option exists for the adapter fence.

`host: "next"` sets waysInLayer to app, adds proxy.ts/instrumentation.ts entries and next-env.d.ts generated declarations, excludes .next and retains shell-free global-error styling behavior. Explicit area overrides win. Generic main/index entries stay out unless named. Use tsconfig/next.json, shadcn({host:"next"}) and configs.nextHost as appropriate.

Browser checks follow package contracts, app descriptors and client endpoints transitively. Installed domain/application/identity contracts are explicitly trusted in src or built dist form; consumer trustedContractPackages adds other reviewed doors. This is not blanket trust for installed package mains. The no-computed-import rule ensures dynamic specifiers cannot hide production edges.

## Other presets and bins

recommended enables comment-discipline and command-kind at error and remains independent of features/design/Markdown. command-kind covers production src regardless of app roots, with validated kit implementation, owner-src-relative test and top-level tooling exceptions. testing is the testing-export rule alone. design returns CSS and source blocks; scale/layer checks are opt-in through their documented options. shadcn preserves its component-folder exemptions and six third-party rules. See each guide above for the unchanged option contracts.

Use house-rules-pins, house-rules-migrations and house-rules-layout from package bins. Migrations accepts --adapter-package repeatedly; layout accepts --cwd. Package migration location/name/adoption rules match @house-rules/migrations. Domain modules are packages; folder locations are rejected. Read-model SQL accepts static tagged SELECT or WITH...SELECT over published views and proven scalar value parameters only; SQL functions and unsupported grammar fail. Ordinary module SQL ownership and transaction checks still have text-scan limits. See the [grammar and limits](docs/migrations.md#limits). Tests exercise the runner and checker against shared fixture files.

## Upgrade notes

BREAKING authoring migration: recommended enables house-rules/command-kind at error without opt-in. Replace readOnly:true defineFeature queries with direct defineReadModel calls in read-models/<name>/index.ts. Remove the own readOnly flag, preserve the descriptor name, schemas, permissions, edges and handler, and move query imports from Features to a separate ReadModels registry. Register and expose the queries directly. Projection services stay in projections/; do not add pass-through features. Command options/flags must be inline objects with literal boolean flags, without spreads, computed keys, accessors, methods, duplicate keys or __proto__. Call builders directly through named kit imports, never wrappers or finished command descriptors from tests/tooling, indirect value calls or CommonJS/dynamic builder loaders. Every nonliteral dynamic import in production src reports command-kind; nonliteral require also fails closed. Literal import/require of readable production modules containing finished features or builder wrappers can fail even for unrelated exports. Kit-door dynamic imports and bare or dynamically indexed application namespace values also fail conservatively, including non-builder uses. Use static named ESM imports. These module-level fences do not prove arbitrary JavaScript behavior or handler purity. readOnly:false commands remain valid. Runtime compatibility for legacy feature descriptors is unchanged. See [command-kind](docs/command-kind.md).

Under host next, src/app is one way area, with npm access limited to Next convention files and `_`-prefixed private folders; other files stay on the normal way imports. The unreleased v2 correction is breaking. Version 0.19.0 awaits approval for release. Enable featuresConfig or configs.features; no old preset alias exists. Area keys are features/readModels/projections/waysIn/composition. Domain modules are packages, never app folders. Unknown area keys are rejected without aliases. Next uses waysInLayer. Builders require direct named kit imports; import renames are allowed. Non-kit production workspace packages cannot import defineFeature, defineReadModel, defineWay or endpoint, even unused. Direct defineOperation and bindOperation imports support descriptors and service-capturing binders. No non-kit production code may re-export any kit builder, including bindOperation and star exports. Finished descriptors, binder doors and plain <Module>Mount values remain valid. A mount carries a service key, operation descriptors and a service-capturing binder; it is not a kit builder. Re-exporting an actual kit builder inside a mount still fails. Production app and Effect workspace-package src is ESM-only, including both kits. CommonJS builder loaders and nonliteral require still fail in other production package source. Rules and top-level tooling are outside the ESM-only scope. Installed non-workspace npm re-exports are not inspected. Each feature/read-model entry folder contains only index.ts and tests/. The index contains exactly one matching defineFeature/defineReadModel call, exported directly from application/contract. Exposures and starts trace through imports and barrels to this app's feature indexes or Features registry. The registry checker matches app law: export only Features and permitted feature/type re-exports; declare built-in roles and system permissions in composition/access.ts. Permission lists, including empty and unexported lists, are rejected. defineOperation and bindOperation stay outside features/. The ESLint feature rules use literal features/, even when Dependency Cruiser has a custom feature area.

no-computed-import now covers production app source too. Markdown links admit tracked and non-ignored untracked regular files, but reject directories and tracked-ignored files. Read-model SQL uses the linked bounded grammar, and production app code cannot open units. Migration chunks use the runner's reserved breakpoint lines before SQL tokenization. A raw whole-word guard bans standard_conforming_strings, backslash_quote, set_config and pg_settings anywhere in migration/read-model SQL, including literals, comments and dollar bodies. The runner sets standard_conforming_strings on first inside its transaction and before every chunk. PL/pgSQL, DO bodies and dynamic EXECUTE need review, not semantic analysis by this checker. A SELECT-only role granted published views is a planned follow-up, not phase 1 implementation. Plain/N SQL strings with backslashes must use E or dollar quotes in read models and view-DDL scans. Port failing cases rather than adding exemptions.

For an approved upgrade, review the rule diff, update exact pins and the lockfile together, then run package and consumer checks.

## History

The v2 correction removed the nodes and modules area keys and deliveryLayer.
Retired node-file and entry-from-app-node links remain on the site retirement notice.
Historical changes remain relevant, not alternate configuration paths:

- Unreleased: shares disk-parsed import graphs and workspace metadata across linted files. File and directory stat checks refresh changed sources and package lists in long-lived ESLint processes. The current file always uses ESLint's own AST and scopes. Lint rules and results are unchanged.
- 0.19.0 corrects the breaking Next host B2 behavior for `src/app`.
- 0.18.0 added multiple disjoint roots, whole-star root segments and migrations' layout-config root discovery.
- 0.17.0 split the kits into domain and application and narrowed installed contract trust to their reviewed doors.
- 0.16.3 documented the Node Host entry; 0.16.2 added stable Effect SQL/HTTP/AI paths while retaining RC-path checks.
- 0.16.1 removed generic Next entry defaults and disabled untyped JavaScript; 0.16.0 removed serverEntryFiles in favor of composition and the router.

Only the repository publish workflow publishes releases.

## Verify

Run package typecheck/test and pack:check. Consumer wiring is proved by root check/test and packed-consumer. Do not lower severities, skip fixtures or bypass hooks. Dependency/version changes need approval. Snapshot regeneration is intentional, never a substitute for passing/failing graph tests.
