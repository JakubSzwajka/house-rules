# @house-rules/capability: notes for agents

## What it does

It turns one use-case into a capability: a contract (name, input, output, failure, permission) plus one Effect handler. `implement` wraps the handler in gates: `CallWatch` around everything, then `Grant`, then `Approval` when the contract asks for it, then `UnitOfWork.atomic` when the contract is transactional. `toTool` turns a contract into an MCP tool. The full guide is `README.md` in this package.

## How an app mounts it

There is no single layer. The app provides the slots its contracts need, once, in its runtime:

| Slot | Production | Tests |
| --- | --- | --- |
| `Grant` | `Effect.provideService(Grant, Grant.fromPermissions(list))` per request | `Grant.allowAll`, `Grant.denyAll`, `Grant.layerFromPermissions(list)` |
| `Approval` | `elicitationApproval` on the MCP route | a fake `Approval` layer |
| `UnitOfWork` | `sqlUnitOfWork`, from the same `SqlClient` layer as the stores | `memoryUnitOfWork` |
| `CallWatch` | `@house-rules/call-audit` | nothing: the default passes through |

No `migrations.json` line: this package owns no tables.

Hooks the app wires itself:

1. [ ] Set the channel in each runner that is not MCP: `Effect.provideService(CallChannel, "web")`. MCP calls get `"mcp"` or `"mcp:<client>"` on their own.
2. [ ] At the edge, take the request id: `requestIdOf(headers.get(requestIdHeader))`, else `yield* newRequestId`. Forward it, echo it on the response, and run the request inside `withRequestId(id)`. That sets `CallRequestId` and annotates every log line with `requestId`.
3. [ ] Build MCP tools only with `toTool(capability.contract, ...)`, and run `capability.handler` in the tool handler.

## Contract options

| Option | Effect |
| --- | --- |
| `permission` | `"resource:action"` or `"public"`. Required. Non-public adds `Grant` and `Forbidden`. |
| `needsApproval` | `true` adds `Approval` and `ApprovalDenied`. |
| `transactional` | `true` runs the handler in one unit of work, adds `UnitOfWork` and `UnitOfWorkFailed`. |
| `annotations` | `readOnly` (call kind `read`, MCP hint) and `destructive`. Both default to `false`. |
| `audit` | `{ target: "<input field>" }`: a string field of the input whose value becomes the call's target id. |

## Fixed rules

- A handler is an Effect. Expected errors are `Schema.TaggedError` classes. Never `throw`, never `Effect.run*`.
- No app calls `Tool.make` by hand. Surfaces come from contracts.
- A `CallWatch` must return the exit of `run` unchanged.
- The audit target is a field name, never a function. Only a string value is recorded, capped at 256 characters.
- Review rule: `audit.target` names an id field (`tripId`), never free text (title, note). The type cannot prove it: `target: "note"` compiles and stores the note.
- `around` takes `facts` as an optional fourth argument. A watch must handle `undefined` (use `unknownCallFacts(contract)`).
- A capability cannot opt itself out of the watch.
- The request id only traces. It never decides access. Only an id that passes `requestIdOf` (`^[A-Za-z0-9._:-]{1,128}$`) is kept; anything else gets a fresh one.
