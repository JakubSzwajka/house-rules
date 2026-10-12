# No computed import rule

Rule ID: `house-rules/no-computed-import`

A package's source imports by string literal only. Dependency Cruiser draws an edge for `import("./facade.ts")`, but none for `import(at)`, so a computed specifier hides what a file loads from every graph check. The one that matters most is `contract-entry-is-browser-safe`: a contract entry could load its own facade, and through it SQL, and the rule would pass. Enable it with `plugin.configs.capability`, which runs it on production files under `packages/*/src/`. Test files and apps are not checked.

```ts
await import("./booking.ts"); // passes
await import(`./booking.ts`); // passes: a template with no expressions
const at = "./facade.ts";
await import(at); // reported
await import(`./${name}.ts`); // reported
require(at); // reported
```

The message is `This import() computes its specifier, so no check can see what it loads. Import by a string literal, or move the choice into a table of literal imports.`

A repository whose packages live outside `packages/` passes the same folder it gives `layout({ packagesDir })` to the preset factory:

```js
import { capabilityConfig } from "@house-rules/rules";

export default [...capabilityConfig({ packagesDir: "libs" })];
```
