# feature-builders

`defineFeature` may be called only in an app's `src/features/<name>/index.ts`. It is the feature's entry, including system starts for hooks, schedules and events. `defineOperation` and `bindOperation` may not be called anywhere in `features/`, including the registry. Tests are exempt. Arguments to `endpoint`, `defineWay.features`, event `defineWay.feature`, `defineWay.public`, `May.context`'s features, `May.system` and `runFeature` must trace to this app's `defineFeature` calls in `features/<name>/index.ts`. Imports, re-export barrels and `Features` registry members retain that origin. Object literals, operation spreads and composition-built feature objects fail, even if their types look like features.

`May.fixed(permissions)` takes permission strings, not features. It needs no feature-origin check. `May.system(features, options)` checks its first argument and requires inline options. `May.context(may, options)` and `defineWay(options)` require inline options with exactly one `features` property, except event ways, which use one `feature` and mandatory `mean`. All three reject options variables, imports, spreads, computed keys, getters and methods. The optional `defineWay.public` property must be declared once in those inline options and traces feature origins exactly like `features`. Feature lists may still trace through local values, imports and the Features registry.

For example, `May.context(may, { features: [Features.show], system: [], via: "test" })` passes. Adding `...{ features: [{}] }` or a second `features` property fails, even after a valid feature list. `May.system([Features.show], { system: [], via: "schedule" })` passes; its options need no `features` key.

Hook, schedule and event variants use the same inline options and feature-origin checks. Their exposed features must declare a system start, either an explicit system caller or the named systemStart helper. Person defaults and person starts fail. Protocol literals wrapped in `as const` and constant identifiers retain this check. An unresolved protocol fails closed. A schedule lists its selector and item features; a hook lists its slot feature. An event way uses a singular feature and rejects a features list. Runtime acquisition also validates system reasons and feature identity.

## Builder imports

Use direct named imports from these doors. Import renames are allowed, runtime aliases are not.

| Builder | Door |
| --- | --- |
| `defineFeature` | `@house-rules/application/contract` |
| `defineOperation` | `@house-rules/domain/contract` |
| `bindOperation` | `@house-rules/application` |
| `defineWay` | `@house-rules/application` |
| `endpoint` | `@house-rules/application/contract` |

Namespaces, destructuring, runtime aliases, callbacks, `.call`, dynamic imports and builder barrels fail. Relative and workspace re-exports retain builder identity, including renamed and star re-exports. CommonJS kit loaders, builder-bearing loaders and nonliteral require fail closed. Unrelated third-party APIs named `endpoint` remain allowed.

Non-kit production workspace packages cannot import `defineFeature`, `defineWay` or `endpoint`, even unused. They may define operations and export service-capturing binders that call `bindOperation`. No non-kit production code may re-export a kit builder. Finished operation descriptors, feature values and binders are values, not builders.

App way factories may call `defineWay` directly with valid inline options and return completed ways, injecting startup Who sockets or resource settings. Importing these factories or a root aggregator of completed ways does not import a builder. The defining calls still undergo the usual options and feature-origin checks. Returning the constructor, aliasing it or forwarding arbitrary builder arguments remains forbidden; factories do not permit per-request actor capture.

Enable `configs.features` or `featuresConfig({ appsDir, packagesDir })`. Scope covers production JS/TS under the declared app and package roots. Only the real configured domain/application kit roots with matching package names are exempt. Nested manifests grant no exemption. Test exemptions are relative to the owning `src/`, never an ancestor or workspace named `tests`. Top-level tooling outside `src/` is exempt. Installed non-workspace npm re-export contents are not inspected.

The separate `feature-file` rule checks the single builder call and export, file layout, feature imports and registry values. `esm-only-effect` bans CommonJS across production app and Effect-package source, including the kits.
