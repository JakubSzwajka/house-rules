# command-kind

`configs.recommended` enables `house-rules/command-kind` at error. No `featuresConfig` opt-in is needed. A command uses `defineFeature`; an exposed query uses `defineReadModel` directly in `read-models/<name>/index.ts`.

Command options and flags must be inline objects. Every flag value must be a literal boolean. Omitted flags and `readOnly: false` are valid. `readOnly: true` fails. Options/flag aliases, imported or unknown sources, spreads, computed keys, accessors, methods, duplicate keys and plain or quoted __proto__ keys fail closed, even if their apparent value is false. TypeScript assertions and satisfies wrappers do not hide a value.

```ts
import { defineFeature } from "@house-rules/application/contract";
export const changeTitle = defineFeature("change_title", {
  description: "Change an item's title.",
  permission: "items:write",
  input: change.input,
  output: change.output,
  failure: change.failure,
  edges: [change],
  flags: { readOnly: false, transactional: true },
  handler: (input, { call }) => call(change, input),
});
```

Call defineFeature directly through a named kit import; import renames are allowed. The default rule rejects builder value escapes, including call/apply/bind, Reflect.apply, sequence callees, namespace destructuring and dynamic builder imports. It follows readable relative/workspace re-exports and wrappers, including mixed-builder wrappers defined in exempt tests or tooling. Finished command descriptors from those exempt sources cannot be imported, referenced or re-exported into production either, including star barrels consumed as namespace values. Those sources keep their own authoring exceptions, not a production bypass. Foreign APIs with the same name and local shadowed bindings are not kit builders. [feature-builders](feature-builders.md) also protects placement, re-exports, read-edge origins and exposure identity. A forged object with kind/readOnly fields is not an entry point.

The loader fence covers string literals and no-expression template literals, CommonJS require, require.main.require, node:module/module createRequire (including the named Module export), process.getBuiltinModule("node:module").createRequire, their aliases and destructuring, and TypeScript import-equals. Known foreign loaders and shadowed bindings stay outside kit identity checks.

Every nonliteral dynamic import in production src reports command-kind, even without evidence that its result contains a builder. Nonliteral require sources also fail closed. Literal import/require loading of a readable production module containing a finished feature or builder wrapper can report too, even when the requested export is unrelated. These are conservative module-level fences, not a proof of arbitrary JavaScript behavior or handler purity. Prefer static named ESM imports. Kit-door dynamic imports and bare or dynamically indexed application namespace values are rejected even when the intended value is not a builder; static namespace members that are not builders are not rejected by this rule.

The default scope is production `src/` under any app/package root, including nested examples. Test exemptions are relative to that source folder, not a workspace named test/tests. Tests, top-level tooling outside src and validated domain/application implementations in declared workspace roots retain their exceptions. A feature, read-model or way folder named test/tests is still production; only its nested tests are exempt. An ancestor directory named src outside the consumer root does not turn its scripts into production. Workspace discovery reads pnpm-workspace.yaml, including roots outside packages/. Running ESLint from inside src does not change the scope. A nested package.json or a foreign package name grants no kit exemption. Production src/scripts is not tooling.

## BREAKING migration

Replace a read-only `defineFeature` with `defineReadModel`, move it from features/<name>/index.ts to read-models/<name>/index.ts and remove its own readOnly flag. Preserve its public name, schemas, permission, edges and handler. Queries still compose domain calculations; SQL is not required.

Split the root registries into Features and ReadModels. Update composition, ways and client imports to expose the read model directly. Do not leave a wrapper feature. Keep SQL/service projection infrastructure in projections/, separate from exposed queries.

Runtime compatibility for existing legacy descriptors is unchanged. Authoring lint no longer allows them. [feature-file](feature-file.md) checks the matching folder/registry, while feature-builders checks declared read-only reachability, transitively through process and system edges. Graph checks trust descriptor metadata and do not prove arbitrary handler purity.
