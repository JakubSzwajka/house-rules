# @house-rules/capability: notes for agents

## What it does

It turns one use-case into a capability: a contract (name, input, output, failure, permission) plus one Effect handler. `implement` wraps the handler in gates: `CallWatch` around everything, then `Grant`, then `Approval` when the contract asks for it, then `UnitOfWork.atomic` when the contract is transactional. `toTool` turns a contract into an MCP tool. Version 0.16.0 peers on exact `effect` 4.0.3. The full guide is `README.md` in this package.

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
| `caller` | Per adapter, `call` or `admit`. Turns `{ headers, url }` into `Context<Viewer \| Grant ...>` or `Refused`. Defaults to `app.caller`. |
| `admitted` | `call` only. Reuses the opaque value from `admit` on this composition, without running a caller. Cannot be combined with `caller`. Keeps the admission request id and channel. |
| `channel` | `admit` defaults to `"web"` and sets it inside the caller. `call` sets it inside the capability, using its own option, else the admitted channel, else `"web"`. |
| `views` | Failure tag to `(error, caller) => { status, body, headers?, code? }`. Defaults cover `Refused`, `InputInvalid`, `Forbidden`, `ApprovalDenied`, `UnitOfWorkFailed`, `NoOpenUnit`, `CompositionClosed`. The composition's table also needs a view for each tag the layer can fail with, such as `DbUnavailable`. `InputInvalid` carries `capabilityName`, `field`, `issue` (`unexpected`, `missing`, `invalid`, `repeated`) and `message`, so a view can word a message per capability and field. |
| `approval` | Defaults: `denyAll` on HTTP, `elicitationApproval` on MCP, `allowAll` for `call`. It beats an `Approval` the caller returns, unless set to `"fromCaller"`. |
| `origins` | The app's origins for the CSRF check, each a plain `http(s)` origin; anything else, `"null"` too, throws at mount. Default: the request URL's origin. |
| `maxBodyBytes` | Write body limit. Default 1 MB; over it is 413. |
| `route(cap, "GET /x/:id", { status, csrf })` | Default `POST /<name>`. `csrf: { skip: true, reason }` opts one route out. `route(cap, endpoint)` takes method, path and status from an endpoint the SPA client shares. |

A single-page app imports only `@house-rules/capability/contract` and packages' `/contract` entries: `toHttpClient(endpoints, { prefix })` gives Effect calls that need `HttpClient` and fail with `HttpFailure { code, status, body }`; `toOpenApi(routes, { title, version, views })` describes the routes. Use `problemView(status, code, message)` so OpenAPI knows a view's status. A client sees a failure code only when the view opts in (`problemView(..., { exposeCode: true })`) and the endpoint declares it (`endpoint(contract, at, { codes: [...] })`); anything else is `Unknown`. The opt-in gates only the `x-failure-code` header; the view's body goes out as its author wrote it.

### Admit before parsing

When a delivery must refuse a token before parsing its own input, run `admit` first:

```ts
async function handle(request: Request) {
  const incoming = { headers: request.headers, url: request.url };
  const auth = await admit(app, incoming, { caller: bearerWrite, channel: "api" });
  if (!auth.ok) return Response.json(auth.view.body, { status: auth.view.status, headers: auth.view.headers });
  const input = await request.json();
  return call(app, updateBooking, input, incoming, { admitted: auth.value, approval: Approval.denyAll });
}
```

`admit` returns `Outcome<Admitted, Refused | E>`, where `E` is the app layer error. It runs in the app runtime, sets `CallRequestId` and the log annotation from a safe `x-request-id` or a fresh id, and maps refusals through the app's views. `Admitted` has no expiry and holds the resolved caller for the composition's lifetime, so delivery must use it for one request only and never cache it, since a cached value would outlive token revocation. The same value may run several capabilities on this app. `call()` uses the admitted channel unless its own `channel` option is set. Another composition, or a call that also supplies `caller`, rejects it with a logged `internal_error` without running a caller or capability. Capability gates still run on every call; `approval: "fromCaller"` reads the resolved context. Layer failure, shutdown and defects answer the same views as `call`.

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
| `transactional` | `true` runs the handler in one unit, adds `UnitOfWork` and `UnitOfWorkFailed`, and removes `NoOpenUnit` from its error type by turning it into a defect. Delete hand-written catches of that error. |
| `annotations` | `readOnly` (call kind `read`, MCP hint) and `destructive`. Both default to `false`. |
| `audit` | `{ target: "<input field>" }`: a string field of the input whose value becomes the call's target id. |

## Fixed rules

- Delivery: a missing view, a view that takes the wrong error, or a service nobody provides is a compile error at `toFetchHandler`, `toMcpHandler` or `call`. A layer error tag without a view is one at `composition()`. Never cast it away; add the view.
- Delivery: a layer that fails to build with a tagged error answers that error's view on every adapter; `call` and the MCP handler resolve, never reject. A dying layer is the fixed 500. The next use builds the layer again, so read `app.runtime` each time instead of keeping it.
- Delivery: requests run as fibers of the app runtime. `app.dispose()` is final: it interrupts running requests, then closes the layer, and never rebuilds it. Later requests answer `CompositionClosed`, 503 `unavailable`, on every adapter.
- Delivery: the success body is the encoded contract output over HTTP and MCP. `call` returns the handler's typed value without encoding.
- Delivery: there is no success view; paging goes in the body, such as `{ items, next }`.
- Delivery: a GET array field takes a repeated key, `status=a&status=b`, and one key is a one-item list. A comma is data. A repeat on any other field, an unknown key and a path key in the query stay 400s. Write a GET default in the contract with `Schema.withDecodingDefaultKey`.
- Delivery: any write that carries a `Cookie`, whatever the caller, from another origin or an opaque one (`null`) is a 403 before the layer builds or the caller runs. A route skips it only with a written `reason`.
- Delivery: the caller runs before input is read or decoded, so refusals do no capability service work. The app layer still builds on the first request, a refused one too. `InputInvalid` never quotes a value. A repeated JSON member, a `__proto__` key and a body that is not valid UTF-8 are 400s. A defect anywhere, a throwing view or an output that does not encode too, is a 500 `internal_error`, logged with the request id. A view may not answer 500: `problem` and `problemView` refuse a literal 500, and a view that answers 500 anyway sends `internal_error` while its body goes to the log.
- Delivery: each handler builds its own router. A fetch handler never answers MCP or another handler's routes.
- Delivery: a failure response never names the error's tag or fields. A 4xx carries `x-failure-code` only for a code its view exposes and its endpoint declares, so a view that hides one failure behind another stays hidden.
- `src/contract.ts` is the browser entry. Anything it reaches must stay browser-safe; `contract-entry-is-browser-safe` checks it. Consumer apps trust it by name, so it may import only `effect` modules on the rule's allowlist.

- A handler is an Effect. Expected errors are `Schema.TaggedError` classes. Never `throw`, never `Effect.run*`.
- No app calls `Tool.make` by hand. Surfaces come from contracts.
- `toTool` sets `Tool.Strict`: an MCP call with a key the input does not take fails with `InvalidParams`. A Union input decodes through a gate that checks only its keys, then the real Union; MCP sees one merged object. Its JSON `required` errs strict: a key every member has is required unless one member is plainly optional for it on both sides, so a decoding default is still required there. The static `Encoded` type is the merged wire shape and keeps wire-side requiredness.
- A `CallWatch` must return the exit of `run` unchanged.
- The audit target is a field name, never a function. Only a string value is recorded, capped at 256 characters.
- Review rule: `audit.target` names an id field (`tripId`), never free text (title, note). The type cannot prove it: `target: "note"` compiles and stores the note.
- `around` takes `facts` as an optional fourth argument. A watch must handle `undefined` (use `unknownCallFacts(contract)`).
- A capability cannot opt itself out of the watch.
- The request id only traces. It never decides access. Only an id that passes `requestIdOf` (`^[A-Za-z0-9._:-]{1,128}$`) is kept, untrimmed; anything else gets a fresh one, 32 lowercase hex characters.
