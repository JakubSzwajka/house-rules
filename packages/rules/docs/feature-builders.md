# feature-builders

`defineFeature` may be called only in an app's `src/features/<name>/index.ts`. It is the feature's entry, including system starts for hooks and schedules. `defineOperation` and `bindOperation` may not be called anywhere in `features/`, including the registry. Tests are exempt. Arguments to `endpoint`, `defineWay.features`, `defineWay.public`, `May.context`'s features, `May.system` and `runFeature` must trace to this app's `defineFeature` calls in `features/<name>/index.ts`. Imports, re-export barrels and `Features` registry members retain that origin. Object literals, operation spreads and composition-built feature objects fail, even if their types look like features.

`May.fixed(permissions)` takes permission strings, not features. It needs no feature-origin check. `May.system(features, options)` checks its first argument and requires inline options. `May.context(may, options)` and `defineWay(options)` require inline options with exactly one `features` property. All three reject options variables, imports, spreads, computed keys, getters and methods. The optional `defineWay.public` property must be declared once in those inline options and traces feature origins exactly like `features`. Feature lists may still trace through local values, imports and the Features registry.

For example, `May.context(may, { features: [Features.show], system: [], via: "test" })` passes. Adding `...{ features: [{}] }` or a second `features` property fails, even after a valid feature list. `May.system([Features.show], { system: [], via: "schedule" })` passes; its options need no `features` key.

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

Enable `configs.features` or `featuresConfig({ appsDir, packagesDir })`. Scope covers production JS/TS under the declared app and package roots. Only the real configured domain/application kit roots with matching package names are exempt. Nested manifests grant no exemption. Test exemptions are relative to the owning `src/`, never an ancestor or workspace named `tests`. Top-level tooling outside `src/` is exempt. Installed non-workspace npm re-export contents are not inspected.

The separate `feature-file` rule checks the single builder call and export, file layout, feature imports and registry values. `esm-only-effect` bans CommonJS across production app and Effect-package source, including the kits.
