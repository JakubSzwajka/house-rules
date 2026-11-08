# @house-rules/rules

This is the installable home of the house rules and tool presets for workspaces whose apps build on Alchemy Domain. Consumers keep project values, stack-only files such as CI/environment/hooks, prose and wiring tests. They do not copy presets. Version stays 0.20.1 until an approved release.

## Presets

The root plugin key is house-rules. It loads @typescript-eslint/parser but no optional Markdown, CSS, shadcn or Dependency Cruiser peer. recommended checks comment-discipline on JS and TS. testing checks testing-exports-only-in-tests. workspaceConfig({appsDir, packagesDir}) and configs.workspace enable no-hand-rolled-surface, testing exports, esm-only-effect, no-hand-run-effect on tests and no-computed-import on production package/app source. Roots are exact paths or nonempty root arrays, matching layout().

The markdown subpath loads @eslint/markdown for relative links to tracked or non-ignored untracked regular files inside the repo. It checks before commit; CI and acceptance still catch linked files left out of the commit. design loads @eslint/css for token/colour/scale/layer checks; shadcn loads @shadcn/lint and the local raw-element check. Component folders own styling. Shell-free host files may use raw elements/inline styles, but keep other checks. nextHost ignores generated Next files only.

The CommonJS dependency-cruiser subpath exports layout(). It loads only hosts.cjs, layout-option-parsers.cjs and layout-patterns.cjs, never node_modules. All forbidden rules are error severity. The README table lists every check; each error links to its stable rule anchor. Intentional config changes update both snapshots and behavioral fixtures.

TypeScript presets are strict, effect, web and next. Effect extends strict and owns the diagnostic plugin block; web supplies browser libs/bundler resolution without replacing it. Next adds host compiler settings. Biome supplies formatting/linting and Tailwind directive parsing; consumer includes remain consumer-owned.

## Workspace words

An app is a folder under an apps root. The layout rules give it no required folders: an Alchemy Domain app picks its own, and the root AGENTS.md decides the domain package shape. A package is a folder under a packages root with one door, `src/index.ts`, plus subject folders, `adapters/` and `tests/`. Generated declarations are exempt only from unresolved imports.

A subject is a folder directly under a package's `src/`. Subject edges exclude tests, adapters and root files. Adapters hold SQL, driver and platform imports; only the package door and adapter code import them.

The retired house-rules kits (features, read models, ways, composition, facades, storage ports, contract doors and SQL migrations) have no checks here. Their rule names stay as retired anchors on the site rules page.

## Bins

house-rules-pins checks exact dependency/packageManager pins, exact workspace pins and full-SHA Git specs. It reads the declared workspace roots without hoisting or a second lockfile.

house-rules-layout cruises production imports and checks package and subject-folder cycles. Package edges exclude tests. Ordinary Dependency Cruiser violations remain the dependency check's job.

## Maintenance

Keep source modules small and ship checked-in src without a build. Each source belongs in the typecheck command. Tests exercise exported plugin/presets and real passing/failing graph fixtures; small pure helpers may have unit tests too. Keep all security, design, comment, pin, test and adapter checks. No new dependency or severity reduction without approval.

Change a rule's source, docs, meta and README table together, then regenerate site/src/content/docs/rules/index.md. Never hand-edit that generated page. Run package typecheck/test and focused static checks. Root check/test and packed-consumer prove final integration, not a replacement for behavioral fixtures.
