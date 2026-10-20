# node-file

Each app node has features/<name>/node.ts and handler.ts. node.ts exports exactly one direct defineNode descriptor, imported from @house-rules/domain/contract. handler.ts exports exactly one direct bindNode binding, imported from @house-rules/application and bound to the descriptor imported from its own node.ts. Optional entry.ts exports exactly one const, a direct named-import defineEntry from @house-rules/application/contract applied to its own node imported by name from ./node.ts. Its value and type imports are only that own node.ts and the application contract door. Own-node identity is resolved from the import, not the local name. Internal nodes need no entry.ts. Type exports are allowed in all three files. Tests are exempt.

```ts
import { defineNode } from "@house-rules/domain/contract";
import { Schema } from "effect";
export const show = defineNode("show", {
  description: "Show the current report.",
  input: Schema.Struct({}),
  output: Schema.String,
  failure: Schema.Never,
  permission: null,
  readOnly: true,
});
```

Use named imports directly. An import rename such as `import { defineNode as node }` works; namespaces, destructuring, runtime aliases, wrappers, fake local builders, re-exports and extra runtime values do not satisfy the rule. Import bindNode by name too.

A descriptor's value imports are Schema from effect, domain/contract, other node.ts descriptors or contract doors. Dependency Cruiser checks the entire browser dependency tree, including unexposed per-node entry.ts roots, type-only imports, module/read-model contracts and client endpoints.ts. That graph check also catches type-only handler imports that node-file's value-import check does not.

Enable configs.nodes or nodesConfig({appsDir,packagesDir}) alongside layout() with the same roots. There are no old layer/preset aliases. The ESLint node rules use the literal features/ area. A custom layers.features option affects Dependency Cruiser only; node-file has no coverage there and entry-from-app-node cannot accept those descriptors.
