# Dependency Cruiser layout

`layout({scope, appsDir?, packagesDir?, layers?, host?, ...options})` returns the whole config, forbidden rules plus options. Every rule has severity error. The preset loads only its CommonJS siblings, never ESLint or optional peers. Append project rules without replacing preset rules.

## App folders

```text
src/
  features/<name>/index.ts + tests/
  features/index.ts
  read-models/<name>/index.ts + tests/
  read-models/index.ts
  projections/<name>/
  ways-in/<name>/
  composition/
  main.ts
  index.ts
```

Area keys are features, readModels, projections, waysIn and composition. Defaults are the names above. Old layer keys fail as unknown options; there are no aliases. Roots are exact nonempty relative paths or lists of them, with optional whole-star path segments. Apps/packages roots must be disjoint.

Feature/read-model entry points may import kit/package contracts and projection contracts, never other entry indexes. They cannot reach ways or composition. Domain modules are packages; no app modules area exists. Projections import packages/kits only. Read entry points may also import projection contracts. Ways import values from kits, effect, package contracts, feature/read-model indexes and registries, composition and their own way folder, and types through package/read-model doors. Ways never import each other. Composition never reaches ways. main joins the root and ways.

Rules that ban reaching a folder follow re-export bridges. Ways cannot use root entries or files outside src as bridges. Projections reject imports into other app folders; read entry points may additionally import projection contracts. Bridges beside src remain forbidden. Imports must respect package and read-model doors. Type-only imports still respect those doors and domain's no-house-rules fence. No package imports an app, and no app imports another app. Other packages are imported by declared name and public door only.

The application kit never imports event-log, even type-only. `application-does-not-import-event-log` keeps event delivery behind application's caller-owned EventSource port. EventLog supplies a removable source plug. System event ways fit the existing ways-in/events/ area without a layout exemption.

## Ways value imports

`ways-in-import-contracts-only` checks every production file in the way area, including re-export barrels. Values may come only from `@house-rules/application`, `@house-rules/application/contract`, `@house-rules/domain`, `@house-rules/domain/contract`, `effect`, any package's `./contract` door, the same app's feature/read-model indexes and composition and the way's own folder. Other package main entries allow type-only imports. Within `ways-in/<name>/page/**`, third-party npm values such as React, Radix and Lucide are allowed. Under host next, `src/app` is one way area, and the same allowance applies only to Next convention files at any depth (page, layout, template, loading, error, not-found, global-error, default, route, manifest, icon, apple-icon, opengraph-image, twitter-image, sitemap and robots) and files inside `_`-prefixed folders. Other files under `src/app` get no npm allowance. Workspace package mains and non-kit `@house-rules/*` mains remain type-only. Node builtins, SQL and platform adapters remain forbidden. Tests keep their existing exemption.

The `effect` allowance stops at SQL. A way file, page or Next `src/app` file included, may not import Effect's SQL modules: `effect/sql`, any `effect/sql/<Module>` such as `effect/sql/SqlClient`, or the release-candidate `effect/unstable/sql` paths. The same holds for every `adapterImports` entry, by default `@effect/sql-*` and `@effect/platform-*`. A scoped entry such as `@acme/db` covers both its installed copy and the workspace package folder `packages/db/`, so a way cannot import that package's contract door or main types either. This covers type-only imports too, and still holds when a project's `adapterImports` leaves the Effect SQL paths out. Each such import reports once, as `ways-in-import-contracts-only`. Other `effect` imports, such as `effect`, `effect/Schema` and `effect/unstable/http`, stay allowed. Projection and package adapters keep their SQL imports. Feature/read-model indexes and package/projection contract doors stay browser-safe through `contract-entry-is-browser-safe`; `adapter-imports-only-in-adapters` also fences SQL imports.

Workspace doors and installed source/dist doors follow the same rule, including pnpm symlinks. Package doors, cross-app and cross-way checks still apply. The projection value fence remains in place. Ways may import read-model indexes/registry as exposed entry values, but never projection services or adapters. A barrel inside a way cannot hide a forbidden value import because its own imports are checked. The rule does not follow allowed composition imports into their captured services. Build plugs such as `Identity.who` in composition and pass them to the way.

## Composition

The root owns `composition({ modules, features, ways, may, system })`. It mounts modules, links ports, plugs sockets, opens ways and schedules features. main supplies way values or a factory; the root never imports ways to obtain them. Features never reach composition. Tests may use root wiring.

A Node or Express Host calls serve in main.ts and disposes the fetch router before the root. Host code belongs in @house-rules/node-host or optional @house-rules/express-host, never node:http in Effect app code. Both reuse one listener-free tracked Node bridge. Express creates its own app and listener, without another executor or business router.

## Contract entry

The browser check starts at package src/contract.ts, projections/*/contract.ts, every features/*/index.ts and read-models/*/index.ts, both registries and ways-in/*/endpoints.ts. Feature and read-model indexes are roots even when no way exposes them, including type-only paths. It follows transitive dependencies and refuses adapters, storage, facades, main package entries, Node builtins and untrusted installed code. A feature includes its handler; it stays browser-safe by calling declared edges rather than importing services.

Safe descriptor trees contain schemas, errors, permissions and edges only. Package manifests export only . and optional ./contract, pointing to src/index.ts and src/contract.ts or their built dist mirrors. No other key, pattern or target is valid. The layout bin checks manifests too.

Installed domain/application/identity contracts are explicitly trusted in source and dist form because node_modules graphs are not followed. trustedContractPackages adds other reviewed package names, not package mains. Effect browser modules remain allowlisted. Production computed imports fail ESLint because Dependency Cruiser cannot record a computed edge.

Exact `effect/encoding` is allowlisted at its Effect 4.0.3 export, `dist/encoding/index.js`. A browser ESM bundle of every runtime export resolves without externals. For that barrel, ESLint's `no-computed-import` requires the public specifier, rejecting deep/private paths, relative paths and resolved aliases. No other encoding file gains trust; feature import boundaries and SQL/Node/driver bans stay unchanged.

## Package layout

A package src/ and a projection root allow index.ts, facade.ts, storage.ts, optional contract.ts, adapters/, tests/ and subject folders. Other loose root files fail. utils/helpers/misc fail anywhere. Mechanism names such as types/models/errors/internal fail in any letter case inside packages and projections.

Only index.ts, facade.ts and adapter code import their own adapter production code. Tests may import adapter test support, not production adapters. Subject code never imports its own index/facade/contract barrel; storage.ts stays allowed. SQL/platform/driver imports stay inside adapters or explicitly named plumbing packages. adapterImportsSeverity is not a supported option.

The layout bin checks production cycles between subjects, packages and feature folders, even when individual files are acyclic. Feature-folder edges also follow app files outside feature folders, including features/index.ts barrels. Tests add no cycle edges. Subjects also exclude adapters and root files. Projections have no required memory adapter.

Tests live directly in tests/ folders. Production never imports test code. Existing no-unresolved and deep-import checks stay enabled. Generated declaration exceptions affect only no-unresolved-imports.

## Next and web

host: next sets waysInLayer to app, which is one way area. Route folders are URL paths, not separate ways. Third-party npm imports are allowed in Next convention files at any depth and in files inside `_`-prefixed folders. Loose files elsewhere in src/app stay fenced. Workspace package mains, non-kit @house-rules mains, Node builtins, SQL, platform adapters and projection values remain forbidden. It preserves proxy.ts and instrumentation.ts as entry files, next-env.d.ts as a generated declaration, .next as build output and shell-free global-error behavior. Generic main/index defaults stay out unless explicitly named. Explicit area overrides win; app entry/generated-file options add to host files.

Use tsconfig/web.json for browser libs and bundler resolution. Effect/web code extends effect.json and web.json without replacing the Effect plugin block. Next extends tsconfig/next.json and uses shadcn({host:"next"}) and configs.nextHost. Tailwind parsing remains in the Biome preset.

## Options and verification

Other options retain their contracts: publicEntry, internalDir, adaptersDir, facadeFile, testsDir, appEntryFiles, ownerlessNames, mechanismNames, packageRootFiles, adapterPackages, adapterImports, generatedDeclarationFiles and trustedContractPackages. An empty appEntryFiles list removes generic entries. Empty mechanismNames removes that configurable mechanism list, not the ownerless list. Existing defaults stay unless explicitly changed here.

Custom layers.features names affect Dependency Cruiser patterns only. The ESLint feature-file and feature-builders rules use literal features/; feature-file has no coverage in a renamed feature area and feature-builders rejects defineFeature there. No custom-feature ESLint option exists.

Snapshot files pin the generated config. Behavioral fixtures prove the restrictions; snapshots alone are not browser or privacy proof. Run package tests and house-rules-layout, then consumer check/test/packed-consumer at the integration gate.
