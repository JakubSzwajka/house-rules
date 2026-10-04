# No hand-rolled surface rule

Rule ID: `house-rules/no-hand-rolled-surface`

An MCP tool, an RPC, or an HTTP API endpoint is a surface an outside caller reaches. Build it from a capability's contract, so the name, the description, the input schema and the read and destructive flags are written once. The rule reports a surface built by hand outside the allowed paths. Enable it with `plugin.configs.capability`, which runs it on JavaScript and TypeScript files alike.

```ts
import { toTool } from "@house-rules/capability";
import { Tool } from "effect/unstable/ai";

export const ShowBooking = toTool(showBooking.contract, {
  title: "Show a booking",
  idempotent: true,
  openWorld: false,
}); // passes

export const Hand = Tool.make("show_booking", { parameters: Input }); // reported
```

The message is `Tool.make builds a surface by hand. Define the action once with defineContract and implement from @house-rules/capability, then build the surface from its contract with toTool.`

## What the rule checks

It reports a call to:

| Call | Imported from |
| --- | --- |
| `Tool.make` | `effect/unstable/ai`, or `effect/unstable/ai/Tool` as a namespace or as `make` |
| `Rpc.make` | `effect/unstable/rpc`, or `effect/unstable/rpc/Rpc` |
| `HttpApiEndpoint.make`, `.get`, `.post`, `.put`, `.patch`, `.delete`, `.head`, `.options` | `effect/unstable/http*`, such as `effect/unstable/httpapi`, or its `HttpApiEndpoint` module |

It follows aliases (`import { Tool as T }`), barrel namespaces (`Ai.Tool.make`), casts, and `.call`, `.apply` and `.bind`. It resolves names through scopes, so a local `Tool` or a type-only import is not reported. `Toolkit.make`, `RpcGroup.make` and `HttpApiGroup.make` are not reported: they group surfaces that came from contracts.

## Options

```ts
type Options = [
  {
    allow?: string[]; // default: ["packages/capability/**"]
  },
];
```

Globs are relative to ESLint's working directory. The capability package builds surfaces with `Tool.make` inside `toTool`, so it is allowed by default. Setting `allow` replaces the default.

## Limits

`@house-rules/capability` has `toTool` only. An app that needs an RPC or an HTTP endpoint today adds the projection to the capability package, or allows its own adapter folder with a reason.
