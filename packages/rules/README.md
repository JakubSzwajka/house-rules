# @house-rules/rules

House rules and presets for TypeScript workspaces whose apps build on Alchemy Domain. Version 0.21.0. Install every dependency at an exact version. This package ships checked-in JavaScript with no build step.

## Install and enable

The root entry needs ESLint 10.11.0 and supplies its own TypeScript parser. Optional subpaths load their peers only when used: markdown uses @eslint/markdown 8.0.3; design uses @eslint/css 2.0.0; shadcn uses @shadcn/lint 0.2.0; dependency-cruiser uses 18.4.0. Biome uses 2.5.14. Keep the consumer's runtime and compiler pins as declared by its package.json.

```js
import houseRules, { workspaceConfig } from "@house-rules/rules";
export default [
  ...houseRules.configs.recommended,
  ...workspaceConfig({ appsDir: ["apps", "examples/*/apps"], packagesDir: "packages" }),
];
```

`configs.workspace` is the default-root form of `workspaceConfig()`. It runs no-hand-rolled-surface and testing-exports-only-in-tests on JS/TS, esm-only-effect on app and Effect package source, no-hand-run-effect on tests and no-computed-import on production package/app source. Pass the same roots to `layout()` and `workspaceConfig()`.

## Rules and checks

Each rule id is a stable docs anchor. Change source, tests, docs and this table together, then run `pnpm --filter @house-rules/site generate` in the stack repository.

| Rule | Catches | Tool | Enable via | Docs |
| --- | --- | --- | --- | --- |
| `comment-discipline` | Top-level narrative, multiline comments and adjacent groups; keeps one-line whys beside code | ESLint | `configs.recommended` | [comment-discipline.md](docs/comment-discipline.md) |
| `no-broken-relative-links` | Relative Markdown links to missing, ignored, outside-repository or non-file targets | ESLint | `@house-rules/rules/markdown` | [no-broken-relative-links.md](docs/no-broken-relative-links.md) |
| `design-no-raw-color` | Raw colours in CSS | ESLint | `design()` | [design-no-raw-color.md](docs/design-no-raw-color.md) |
| `design-no-raw-color-literal` | Raw colours in JS/TS strings | ESLint | `design()` | [design-no-raw-color-literal.md](docs/design-no-raw-color-literal.md) |
| `design-no-unknown-token` | CSS custom properties without definitions | ESLint | `design()` | [design-no-unknown-token.md](docs/design-no-unknown-token.md) |
| `design-scale-value` | CSS values off an allowed scale | ESLint | `design()` | [design-scale-value.md](docs/design-scale-value.md) |
| `design-css-layers` | Styles outside allowed layers, restricted-layer violations and important | ESLint | `design()` | `docs/design-css-layers.md` |
| `design-no-raw-element` | Raw JSX elements where a design-system component exists | ESLint | `shadcn()` | `docs/design-no-raw-element.md` |
| `shadcn/*` (six rules from `@shadcn/lint`) | Restyling, palette colours, arbitrary values, inline styles, dynamic classes and unknown classes | ESLint | `shadcn()` | `docs/shadcn.md` |
| `esm-only-effect` | CommonJS loading in production app and Effect workspace-package src | ESLint | `configs.workspace` | [esm-only-effect.md](docs/esm-only-effect.md) |
| `no-hand-rolled-surface` | Tool.make, Rpc.make and HttpApiEndpoint methods built by hand instead of a served Domain.Api | ESLint | `configs.workspace` | [no-hand-rolled-surface.md](docs/no-hand-rolled-surface.md) |
| `no-hand-run-effect` | Effect.run* and ManagedRuntime.make in tests | ESLint | `configs.workspace` | [no-hand-run-effect.md](docs/no-hand-run-effect.md) |
| `no-computed-import` | Computed production imports hiding edges from the layout checks | ESLint | `configs.workspace` | `docs/no-computed-import.md` |
| `testing-exports-only-in-tests` | Testing exports outside tests or testing-only code; path renames that drop Testing | ESLint | `configs.testing`, `configs.workspace` | [testing-exports-only-in-tests.md](docs/testing-exports-only-in-tests.md) |
| `no-cycles` | Circular file imports | Dependency Cruiser | `layout({ scope })` | [dependency-cruiser.md](docs/dependency-cruiser.md) |
| `packages-do-not-import-apps` | Packages importing apps | Dependency Cruiser | `layout({ scope })` | [dependency-cruiser.md](docs/dependency-cruiser.md) |
| `apps-do-not-import-other-apps` | Cross-app imports | Dependency Cruiser | `layout({ scope })` | [dependency-cruiser.md](docs/dependency-cruiser.md) |
| `packages-imported-by-name` | Relative cross-package imports | Dependency Cruiser | `layout({ scope })` | [dependency-cruiser.md](docs/dependency-cruiser.md) |
| `packages-public-entry-only` | Imports past a package's src/index.ts door | Dependency Cruiser | `layout({ scope })` | [dependency-cruiser.md](docs/dependency-cruiser.md) |
| `no-unresolved-deep-package-imports` | Unresolved deep package imports | Dependency Cruiser | `layout({ scope })` | [dependency-cruiser.md](docs/dependency-cruiser.md) |
| `production-does-not-import-tests` | Production imports of tests | Dependency Cruiser | `layout({ scope })` | [dependency-cruiser.md](docs/dependency-cruiser.md) |
| `tests-live-in-tests-dir` | Test files not directly in tests/ | Dependency Cruiser | `layout({ scope })` | [dependency-cruiser.md](docs/dependency-cruiser.md) |
| `tests-do-not-import-internals` | Tests reaching internal directories | Dependency Cruiser | `layout({ scope })` | [dependency-cruiser.md](docs/dependency-cruiser.md) |
| `no-unresolved-imports` | Missing imports, except named generated declarations | Dependency Cruiser | `layout({ scope })` | [dependency-cruiser.md](docs/dependency-cruiser.md) |
| `no-ownerless-files` | utils/helpers/misc anywhere; caseless mechanism names in packages | Dependency Cruiser | `layout({ scope })` | [dependency-cruiser.md](docs/dependency-cruiser.md#package-layout) |
| `package-root-files` | Loose package root files other than index.ts | Dependency Cruiser | `layout({ scope })` | [dependency-cruiser.md](docs/dependency-cruiser.md#package-layout) |
| `domain-does-not-import-adapters` | Imports of private adapter production code except by index.ts and adapter code; tests may use adapter test support | Dependency Cruiser | `layout({ scope })` | [dependency-cruiser.md](docs/dependency-cruiser.md#package-layout) |
| `subjects-do-not-import-package-root` | Subject imports of their own package index.ts barrel | Dependency Cruiser | `layout({ scope })` | [dependency-cruiser.md](docs/dependency-cruiser.md#package-layout) |
| `adapter-imports-only-in-adapters` | SQL/driver/platform imports outside package adapters and named plumbing packages | Dependency Cruiser | `layout({ scope })` | [dependency-cruiser.md](docs/dependency-cruiser.md#package-layout) |
| `no-subject-folder-cycles` | Production subject cycles in packages, excluding tests, adapters and root files | Node | `house-rules-layout` | [dependency-cruiser.md](docs/dependency-cruiser.md#package-layout) |
| `no-package-cycles` | Production package cycles hidden across files | Node | `house-rules-layout` | [dependency-cruiser.md](docs/dependency-cruiser.md#package-layout) |
| Strict compiler flags | strict, unchecked indexes, exact optional properties and other strict flags | TypeScript | `tsconfig/strict.json` | [tsconfig.md](docs/tsconfig.md) |
| Effect diagnostics | Effect diagnostics at error severity | TypeScript | `tsconfig/effect.json` | [tsconfig.md](docs/tsconfig.md) |
| `noReExportAll` | Export-star barrels | Biome | `@house-rules/rules/biome` | [biome.md](docs/biome.md) |
| `noExcessiveLinesPerFile` | Files above 300 lines, warning fails the root check | Biome | `@house-rules/rules/biome` | [biome.md](docs/biome.md) |
| `noNonNullAssertion` | Non-null assertions | Biome | `@house-rules/rules/biome` | [biome.md](docs/biome.md) |
| `useFilenamingConvention` | File names not kebab-case or matching an export | Biome | `@house-rules/rules/biome` | [biome.md](docs/biome.md) |
| Formatter | Two spaces and 100-column formatting | Biome | `@house-rules/rules/biome` | [biome.md](docs/biome.md) |
| Exact pins | Ranges, tags, broad workspace specs and Git refs without full SHAs | Node | `house-rules-pins` | [pins.md](docs/pins.md) |

## Layout options

```js
const { layout } = require("@house-rules/rules/dependency-cruiser");
module.exports = layout({
  scope: "@example/",
  appsDir: ["apps", "examples/*/apps"],
  packagesDir: "packages",
});
```

Roots are exact relative paths with optional whole `*` segments. Roots must be nonempty and disjoint; arbitrary globs, absolute paths and ambiguous overlaps fail. Other options: host, publicEntry, internalDir, adaptersDir, testsDir, ownerlessNames, mechanismNames, packageRootFiles, adapterPackages, adapterImports and generatedDeclarationFiles. No severity option exists for the adapter fence.

`host: "next"` adds next-env.d.ts as a generated declaration, excludes .next and keeps shell-free global-error styling. Use tsconfig/next.json, shadcn({host:"next"}) and configs.nextHost as appropriate.

## Other presets and bins

recommended enables comment-discipline at error and stays independent of the workspace, design and Markdown presets. testing is the testing-export rule alone. design returns CSS and source blocks; scale/layer checks are opt-in through their documented options. shadcn keeps its component-folder exemptions and six third-party rules. See each guide above for the option contracts.

Use house-rules-pins and house-rules-layout from package bins. layout accepts --cwd.

## Upgrade notes

BREAKING in 0.21.0: the rules for the retired house-rules kits are gone. Apps build on Alchemy Domain, which has no features, read models, ways, composition, facades, storage ports, contract doors or SQL migrations.

```text
removed ESLint rules     command-kind, feature-file, feature-builders
removed layout rules     contract-entry-is-browser-safe, features-do-not-import-outer-folders,
                         read-models-import-packages-only, read-models-public-entry-only,
                         ways-in-import-app-folders-only, ways-in-do-not-import-read-model-values,
                         ways-in-import-contracts-only, ways-in-do-not-import-other-ways,
                         composition-does-not-import-ways-in, domain-imports-no-house-rules,
                         application-does-not-import-event-log, app-folders
removed bin checks       no-app-feature-cycles, house-rules-migrations (the whole bin)
removed subpath          @house-rules/rules/app-map
renamed                  featuresConfig -> workspaceConfig, configs.features -> configs.workspace
removed layout options   layers, appEntryFiles, facadeFile, trustedContractPackages
narrowed defaults        packageRootFiles is ["index.ts"]; packages export only "."
                         no-hand-rolled-surface allows no folder by default
```

To upgrade, rename the preset import, drop the removed layout options and run check. A package root `facade.ts`, `storage.ts` or `contract.ts` now fails package-root-files; move it into a subject folder or list it in packageRootFiles. Remove the house-rules-migrations script.

For an approved upgrade, review the rule diff, update exact pins and the lockfile together, then run package and consumer checks.

## History

Historical changes, not alternate configuration paths:

- 0.21.0 removes the checks for the retired kits; see Upgrade notes.
- 0.20.1 shares disk-parsed import graphs and workspace metadata across linted files. File and directory stat checks refresh changed sources and package lists in long-lived ESLint processes. The current file always uses ESLint's own AST and scopes. Lint rules and results are unchanged.
- 0.19.0 corrects the breaking Next host B2 behavior for `src/app`.
- 0.18.0 added multiple disjoint roots, whole-star root segments and migrations' layout-config root discovery.
- 0.17.0 split the kits into domain and application and narrowed installed contract trust to their reviewed doors.

Only the repository publish workflow publishes releases.

## Verify

Run package typecheck/test and pack:check. Consumer wiring is proved by root check/test and packed-consumer. Do not lower severities, skip fixtures or bypass hooks. Dependency/version changes need approval. Snapshot regeneration is intentional, never a substitute for passing/failing graph tests.
