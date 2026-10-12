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

Or mount it through delivery, which wires the hooks below for you:

```ts
export const app = composition({ layer: appLayer, caller: sessionCaller, views }); // the composition root
export const api = toFetchHandler(app, { prefix: "/api", routes: [route(showBooking, "GET /bookings/:id")] });
export const mcp = once("mcp", () => toMcpHandler(app, { path: "/mcp", name, version, caller, tools: [tool(showBooking, hints)] }));
const result = await call(app, showBooking, { id }, { headers, url }); // React server code
```

| Delivery option | Effect |
| --- | --- |
| `caller` | Per adapter. Turns `{ headers, url }` into `Context<Viewer \| Grant ...>` or `Refused`. |
| `views` | Failure tag to `(error, caller) => { status, body, headers? }`. Defaults cover `Refused`, `InputInvalid`, `Forbidden`, `ApprovalDenied`, `UnitOfWorkFailed`, `NoOpenUnit`. |
| `approval` | Defaults: `denyAll` on HTTP, `elicitationApproval` on MCP, `allowAll` for `call`. It beats an `Approval` the caller returns, unless set to `"fromCaller"`. |
| `origins` | The app's origins for the CSRF check, each a plain `http(s)` origin; anything else, `"null"` too, throws at mount. Default: the request URL's origin. |
| `maxBodyBytes` | Write body limit. Default 1 MB; over it is 413. |
| `route(cap, "GET /x/:id", { status, csrf })` | Default `POST /<name>`. `csrf: { skip: true, reason }` opts one route out. |

Hooks the app wires itself when it does not use delivery:

1. [ ] Set the channel in each runner that is not MCP: `Effect.provideService(CallChannel, "web")`. MCP calls get `"mcp"` or `"mcp:<client>"` on their own.
2. [ ] At the edge, take the request id: `requestIdOf(headers.get(requestIdHeader))`, else `yield* newRequestId`. Forward it, echo it on the response, and run the request inside `withRequestId(id)`. That sets `CallRequestId` and annotates every log line with `requestId`.
3. [ ] Build MCP tools only with `toTool(capability.contract, ...)`, and run `capability.handler` in the tool handler.

## Contract options

| Option | Effect |
| --- | --- |
| `input` | A `Schema.Struct`, a `Schema.Union` of Structs, or `NoInput`. The handler gets the decoded type, one member for a Union. |
| `permission` | `"resource:action"` or `"public"`. Required. Non-public adds `Grant` and `Forbidden`. |
| `needsApproval` | `true` adds `Approval` and `ApprovalDenied`. |
| `transactional` | `true` runs the handler in one unit of work, adds `UnitOfWork` and `UnitOfWorkFailed`. |
| `annotations` | `readOnly` (call kind `read`, MCP hint) and `destructive`. Both default to `false`. |
| `audit` | `{ target: "<input field>" }`: a string field of the input whose value becomes the call's target id. |

## Fixed rules

- Delivery: a missing view, a view that takes the wrong error, or a service nobody provides is a compile error at `toFetchHandler`, `toMcpHandler` or `call`. Never cast it away; add the view.
- Delivery: any write that carries a `Cookie`, whatever the caller, from another origin or an opaque one (`null`) is a 403 before the layer builds or the caller runs. A route skips it only with a written `reason`.
- Delivery: the caller runs before input is read or decoded, so refusals do no capability service work. The app layer still builds on the first request, a refused one too. `InputInvalid` never quotes a value. A repeated JSON member and a `__proto__` key are 400s. A defect anywhere, a throwing view or an output that does not encode too, is a 500 `internal_error`, logged with the request id.
- Delivery: each handler builds its own router. A fetch handler never answers MCP or another handler's routes.

- A handler is an Effect. Expected errors are `Schema.TaggedError` classes. Never `throw`, never `Effect.run*`.
- No app calls `Tool.make` by hand. Surfaces come from contracts.
- `toTool` sets `Tool.Strict`: an MCP call with a key the input does not take fails with `InvalidParams`. A Union input decodes through a gate that checks only its keys, then the real Union; MCP sees one merged object. Its JSON `required` errs strict: a key every member has is required unless one member is plainly optional for it on both sides, so a decoding default is still required there. The static `Encoded` type is the merged wire shape and keeps wire-side requiredness.
- A `CallWatch` must return the exit of `run` unchanged.
- The audit target is a field name, never a function. Only a string value is recorded, capped at 256 characters.
- Review rule: `audit.target` names an id field (`tripId`), never free text (title, note). The type cannot prove it: `target: "note"` compiles and stores the note.
- `around` takes `facts` as an optional fourth argument. A watch must handle `undefined` (use `unknownCallFacts(contract)`).
- A capability cannot opt itself out of the watch.
- The request id only traces. It never decides access. Only an id that passes `requestIdOf` (`^[A-Za-z0-9._:-]{1,128}$`) is kept; anything else gets a fresh one.
