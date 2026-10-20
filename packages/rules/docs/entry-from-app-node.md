# entry-from-app-node

Only an app's own node descriptor may start an entry. A module, read-model or package node is an edge, not a public/hook/schedule entry.

```ts
import { defineEntry as enter } from "@house-rules/application/contract";
import { showBooking } from "./node.ts";
export const show = enter(showBooking);
```

The finished Entry lives in optional features/show-booking/entry.ts beside its own node.ts. Ways, endpoints, hooks, schedules and composition import that same value. node-file restricts entry.ts to one direct own-node const Entry and imports only its own node.ts and application/contract; this does not widen descriptor origins.

Call defineNode, defineEntry, defineWay and endpoint directly through named imports from the owning kit door. Import renames such as enter above work. Namespace members, destructuring, runtime aliases, computed access, builder barrels, callback/value passing and dynamic builder imports fail with an instruction to import by name. A relative or workspace-package re-export of a builder does not become another supported builder API. Non-kit production workspace packages may not import defineEntry, defineWay or endpoint, even unused. They use direct defineNode and bindNode imports for descriptors and service-capturing binders. Non-kit production code may not re-export any kit builder, including bindNode, under any name or star export. Finished descriptors and binders are values, not builders. Their public doors and documented app mounts such as bindComments(service) and bindParty(service) are allowed. Domain/application kit implementations, tests and top-level tooling outside src are exempt. The existing packagesDir roots select package source; app calls through package helpers still report the underlying builder. CommonJS require and node:module/module createRequire calls reject kit doors and relative/workspace sources carrying builders; nonliteral loader specifiers fail closed. This covers .cjs and TypeScript under recommended plus nodes. Namespace, import = and default package-helper member calls follow the same builder provenance as named imports. Kit named and star re-export files retain builder identity through relative and workspace doors. Unrelated APIs, including third-party endpoint imports, renames and re-exports, are allowed by import identity, not spelling. The separate esm-only-effect rule forbids all CommonJS loading in production app and Effect package src, including the kits; this narrower builder check still applies to other production packages.

Descriptor and entry arguments may use named imports, const aliases and barrel re-exports. Mutable let/var aliases and mutable exported entries have unresolved provenance and fail. The rule follows those arguments to features/<name>/node.ts in the same app. defineEntry and endpoint may use application or its contract door; defineWay uses the application main door. A node's defineNode comes from domain/contract. Hook and schedule system-start options do not change ownership. Shadowing parameters and unresolved arguments fail, rather than being assumed app-owned.

Enable configs.nodes or nodesConfig({appsDir,packagesDir}), with the same roots as layout(). Test exemptions use paths relative to the owner's src, never ancestor or workspace directory names. Kit exemptions require the real configured domain/application package root and its matching package name; nested package.json files grant no exemption. The ESLint rules require the literal features/ area. Dependency Cruiser supports a custom layers.features area, but node-file does not check that renamed area and this rule cannot accept its descriptors. No custom-node ESLint option or alias is provided.

## Limits

Builder provenance follows relative source and declared workspace package doors. It does not inspect builder re-exports inside installed, non-workspace npm packages. Do not use those packages as builder APIs; review that boundary. Test-path conventions still exempt test/, tests/, __tests__/ and .test./.spec. source paths inside the checkout.
