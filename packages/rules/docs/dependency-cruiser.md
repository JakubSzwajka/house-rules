# Dependency Cruiser layout

`layout({scope, appsDir?, packagesDir?, host?, ...options})` returns the whole config, forbidden rules plus options. Every rule has severity error. The preset loads only its CommonJS siblings, never ESLint or optional peers. Append project rules without replacing preset rules.

## Workspace graph

```text
apps/<app>/src/...                 app code, any folders
packages/<package>/src/index.ts    the one door
packages/<package>/src/<subject>/  subject folders
packages/<package>/src/adapters/   SQL, drivers, platform code
packages/<package>/src/tests/      tests
```

Roots are exact nonempty relative paths or lists of them, with optional whole-star path segments. Apps and packages roots must be disjoint.

No package imports an app, and no app imports another app. A workspace imports another package by its declared name and through `src/index.ts` only. There are no subpaths. A deep import that does not resolve fails as `no-unresolved-deep-package-imports`. No file takes part in an import cycle.

Production code never imports test code. Test files sit directly in a `tests/` folder. Tests never reach a package's `src/internal`. Every import resolves; generated declaration files named in the options are the only exception.

App folders carry no layout fence. An Alchemy Domain app picks its own folders; the domain package rules in the root AGENTS.md decide them.

## Package layout

A package `src/` holds `index.ts`, `adapters/`, `tests/` and subject folders. Other loose root files fail as `package-root-files`. `utils`, `helpers` and `misc` fail anywhere as `no-ownerless-files`. Mechanism names such as types, models, errors and internal fail in any letter case inside packages.

Only `index.ts` and adapter code import their own adapter production code. Tests may import adapter test support, not production adapters. Subject code never imports its own `index.ts` barrel, because that barrel re-exports every subject and would hide a cycle from the subject-folder check. SQL, platform and driver imports stay inside adapters or in packages named by `adapterPackages`. adapterImportsSeverity is not a supported option.

The layout bin checks production cycles between subjects and between packages, even when each file is acyclic. Tests add no cycle edges. Subject edges also skip adapters and root files.

## Next host

`host: "next"` adds `next-env.d.ts` to the generated declarations, excludes `.next` build output and keeps shell-free global-error styling in `shadcn({host:"next"})`. Use tsconfig/next.json and configs.nextHost with it.

Use tsconfig/web.json for browser libs and bundler resolution. Effect web code extends effect.json and web.json without replacing the Effect plugin block. Tailwind parsing stays in the Biome preset.

## Options and verification

Options: scope, host, appsDir, packagesDir, publicEntry, internalDir, adaptersDir, testsDir, ownerlessNames, mechanismNames, packageRootFiles, adapterPackages, adapterImports and generatedDeclarationFiles. Empty mechanismNames removes that list, not the ownerless list. An unknown option fails.

The retired kit options fail with a removal message: layers, appEntryFiles, facadeFile and trustedContractPackages. So do serverEntryFiles and adapterImportsSeverity.

Snapshot files pin the generated config. Behavioral fixtures prove each restriction; a snapshot alone proves nothing. Run package tests and house-rules-layout, then the consumer check, test and packed-consumer at the integration gate.
