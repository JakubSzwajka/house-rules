# feature-file

Each app feature lives in `src/features/<name>/index.ts`. The folder contains only that file and `tests/`. ESLint checks sibling files and folders from the index, including files it does not parse, such as Markdown. Tests inside the feature's `tests/` folder are exempt.

The index exports exactly one value, a direct const `defineFeature(...)` call imported by name from `@house-rules/application/contract`. An import rename is allowed. Runtime aliases, wrappers, default exports and value re-exports are not. Type exports are allowed. Exactly one `defineFeature` call may appear anywhere in the file; a second call fails even if unexported or nested. A system-start feature uses the same shape.

```ts
import { defineFeature } from "@house-rules/application/contract";
import { Effect, Schema } from "effect";

export const ping = defineFeature("ping", {
  description: "Read the service status",
  permission: null,
  input: Schema.Void,
  output: Schema.String,
  failure: Schema.Never,
  edges: [],
  flags: { readOnly: true },
  handler: () => Effect.succeed("ok"),
});
```

Value and type imports are limited to `effect`, kit contract doors, package `./contract` doors, the same app's `projections/<name>/contract.ts` doors and legacy read-model contracts. Other feature indexes, package mains, composition and local handler files are not allowed. Entry points call operations, never other entry points. Literal dynamic imports follow the same allow-list; computed imports fail closed.

Read models use the same shape in `read-models/<name>/index.ts`, with exactly one direct defineReadModel call and no other value exports. Their imports follow this same contract-only list, including projection contracts. They never import features, other read-model entries, services or adapters. Dynamic imports in read entry points are forbidden.

## Feature registry

`features/index.ts` may import and re-export features and build a `Features` object from direct named feature imports. Type declarations and exports are allowed. No calls, stray values, spreads or computed registry members are allowed. Permission lists, including empty lists and unexported lists, are rejected. Declare built-in roles and system permissions in `composition/access.ts`.

```ts
import { ping } from "./ping/index.ts";
export const Features = { ping } as const;
```

`read-models/index.ts` follows the same registry rules and exports only ReadModels from named query imports.

Enable `configs.features` or `featuresConfig({ appsDir, packagesDir })` with the same roots as `layout()`. These ESLint rules use literal `features/` and `read-models/`, not custom layout areas. The browser graph separately follows every feature index and the registry, including type-only paths.
