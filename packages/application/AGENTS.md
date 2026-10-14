# @house-rules/application: notes for agents

## What it does

It turns one use-case into a capability: a contract (name, input, output, failure, permission) plus one Effect handler. `implement` wraps the handler in gates: `CallWatch` around everything, then `Grant`, then `Approval` when the contract asks for it, then `UnitOfWork.atomic` when the contract is transactional. `toTool` turns a contract into an MCP tool. It also owns the request side: `CurrentActor`, callers, composition and HTTP and MCP delivery. Version 0.2.0 peers on exact `@house-rules/domain` 0.1.0 and `effect` 4.0.3. It adds the `Authenticator` slot, `Principal`, `TokenRejected`, `tokenFrom` and `protectedResource` to 0.1.0. With `@house-rules/domain` it replaces the retired `@house-rules/capability`. The full guide is `README.md` in this package.

## How an app mounts it

There is no single layer. The app provides the slots its contracts need, once, in its runtime:

| Slot | Production | Tests |
| --- | --- | --- |
| `CurrentActor` | set by the composition's `Caller` per request | `Effect.provideService(CurrentActor, actor)` |
| `Grant` | `Effect.provideService(Grant, Grant.fromPermissions(list))` per request | `Grant.allowAll`, `Grant.denyAll`, `Grant.layerFromPermissions(list)` |
| `Approval` | `elicitationApproval` on the MCP route | a fake `Approval` layer |
| `UnitOfWork` (defined in domain) | `sqlUnitOfWork`, from the same `SqlClient` layer as the stores | `memoryUnitOfWork` from `@house-rules/domain` |
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
| `caller` | Per adapter, `call` or `admit`. Turns `{ headers, url }` into `Context<CurrentActor \| Grant ...>` or `Refused`. Defaults to `app.caller`. |
| `admitted` | `call` only. Reuses the opaque value from `admit` on this composition, without running a caller. Cannot be combined with `caller`. Keeps the admission request id and channel. |
| `channel` | `admit` defaults to `"web"` and sets it inside the caller. `call` sets it inside the capability, using its own option, else the admitted channel, else `"web"`. |
| `views` | Failure tag to `(error, caller) => { status, body, headers?, code? }`. Defaults cover `Refused`, `InputInvalid`, `Forbidden`, `ApprovalDenied`, `UnitOfWorkFailed`, `NoOpenUnit`, `CompositionClosed`. The composition's table also needs a view for each tag the layer can fail with, such as `DbUnavailable`. `InputInvalid` carries `capabilityName`, `field`, `issue` (`unexpected`, `missing`, `invalid`, `repeated`) and `message`, so a view can word a message per capability and field. |
| `approval` | Defaults: `denyAll` on HTTP, `elicitationApproval` on MCP, `allowAll` for `call`. It beats an `Approval` the caller returns, unless set to `"fromCaller"`. |
| `origins` | The app's origins for the CSRF check, each a plain `http(s)` origin; anything else, `"null"` too, throws at mount. Default: the request URL's origin. |
| `cors` | `{ origins, maxAge? }`. Exact `http(s)` origin allow-list, checked at mount; `maxAge` defaults to 600 seconds. A listed origin's `OPTIONS` preflight to a mounted path is 204 with Allow-Origin, Allow-Methods (every method whose route matches the concrete path), Allow-Headers `authorization, content-type, x-request-id` and Max-Age; an unlisted or missing origin is 403 with no CORS headers. Every answer carries `Vary: Origin`; a listed origin's also carries Allow-Origin and Expose-Headers `x-failure-code, x-request-id`. A non-preflight call from an unlisted origin still runs, with no CORS headers; the caller, `Grant` and the CSRF check guard writes, not CORS. Never Allow-Credentials. Separate from `origins`: a CORS origin makes bearer writes, but a cookie write from it is still 403 `cross_origin` unless it is in `origins` too. Default: no CORS. |
| `maxBodyBytes` | Write body limit. Default 1 MB; over it is 413. |
| `route(cap, "GET /x/:id", { status, csrf })` | Default `POST /<name>`. `csrf: { skip: true, reason }` opts one route out. `route(cap, endpoint)` takes method, path and status from an endpoint the SPA client shares. |

One API list serves the server and a single-page app. `defineApi({ prefix }, { key: endpoint(contract, at?, { status, codes }) })`, browser-safe, throws on two keys at one method and path or one contract twice; `endpoint(contract)` with no address is `POST /<name>`, like `route`. The server mounts it with `toFetchHandler(app, { routes: mount(api, { key: capability }) })`: a missing, extra or mismatched key fails `tsc`, and the contract type must match exactly, not as a supertype (runtime also checks object identity, which `tsc` cannot). `defineApi` accepts a prefix of `""` or a plain absolute path such as `/api`, and rejects `//host`, schemes, backslashes, `?`, `#`, dot segments and a trailing `/`. Endpoint paths must be `/` or segments of `:name` or `[A-Za-z0-9._~-]` (no `.`/`..`, controls, `%`, empty segments). Both clients build each URL as one absolute string and send only to the base origin. A `baseUrl` must be absolute `http://` or `https://` with a host (a path is fine; no user, password, query, fragment, space, control or `\`), or the client throws a `TypeError` when built, so `http:` or `http:127.0.0.1:1234` never authorize a call. With no `baseUrl` the base is the page's http(s) `location.origin`; with neither, every call fails `HttpFailure` `Unknown` status 0 and sends nothing. A URL off the base origin, a path that names a host on its own (raw `endpoint()` paths like `//host`), or a path value that is empty, `.` or `..`, sends nothing and fails `Unknown` status 0. Over `FetchHttpClient` no call follows a redirect: the call wraps the fiber's `FetchHttpClient.Fetch` and forces only `redirect: "manual"`, so a layer-level `FetchHttpClient.RequestInit` still applies; a 3xx fails `Unknown` with its status (0 in a browser). A `Fetch` given only inside the client's layer is not used; provide it to the program. Wrapping `toHttpClient`'s client in `HttpClient.followRedirects` is an explicit opt-out that sends the request, and a 307/308 body, off-origin; only the per-request bearer is stripped, and a layer-provided `Authorization` survives. A caller URL rewrite such as `HttpClient.mapRequest` can also bypass the origin guard. The list owns the prefix: `mount` writes it into each path, so `toFetchHandler` and `toOpenApi` throw when also given `prefix`. The browser calls `toPromiseClient(api, { baseUrl?, token?, onCall?, fetch? })`: Promises that resolve the decoded output, reject with `HttpFailure` (a network failure is status 0; a `token()` rejection propagates as its own error), send `Authorization: Bearer` when `token()` returns one, and report `{ name, method, path, status, ms, code? }` to `onCall`.

Serve the page one of two ways. The default is one service: the Node service serves `/api/*`, `/mcp` and the built page from one origin, with `staticFiles` from `@house-rules/node-host`, and the client needs no `baseUrl`. The allowed alternative puts the page on another origin: mount the API with `cors: { origins: [pageOrigin] }` and give the client `baseUrl: "https://api.example"` and a bearer `token`. `toPromiseClient` turns off trace header propagation, so its cross-origin calls send only allowed headers.

A single-page app imports only `@house-rules/application/contract`, `@house-rules/domain/contract` and packages' `/contract` entries: `toHttpClient(endpoints, { prefix })` gives Effect calls that need `HttpClient` and fail with `HttpFailure { code, status, body }`; `toOpenApi(routes, { title, version, views })` describes the routes. Use `problemView(status, code, message)` so OpenAPI knows a view's status. A client sees a failure code only when the view opts in (`problemView(..., { exposeCode: true })`) and the endpoint declares it (`endpoint(contract, at, { codes: [...] })`); anything else is `Unknown`. The opt-in gates only the `x-failure-code` header; the view's body goes out as its author wrote it.

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

## Authentication pieces

The kit has the provider-neutral parts of auth; a package such as `@house-rules/auth-jwt` fills the slot.

| Piece | Job |
| --- | --- |
| `Authenticator` | slot: `verify(token, { audience? })` gives a `Principal` or fails with `TokenRejected` |
| `Principal` | Schema: `issuer`, `subject`, `audience`, `scopes`, `claims`. No app data. |
| `TokenRejected` | `reason`: `invalid`, `expired`, `wrong_audience`, `wrong_issuer`, `unavailable` |
| `tokenFrom(incoming, source)` | `Option` of the token from `"bearer"` (`Authorization: Bearer`) or `{ cookie: name }` |
| `protectedResource(options \| undefined, unconfiguredResourcePath?)` | RFC 9728 metadata `handler` and `paths`; when configured, `metadata`, `metadataUrl` and `challenge(error?)` for `WWW-Authenticate` |

`protectedResource(undefined, "/mcp")` fails closed: GET and HEAD answer 503 `not_configured`, other methods 405. Configured, GET and HEAD answer the metadata; HEAD has the same status and headers and no body. The authorization server identifiers are served exactly as given. Options typed as defined give the configured shape and `undefined` gives the unconfigured shape; only a union needs a `configured` check before `challenge`. Mount the `handler` on every path in `paths`. Building it throws on a resource or authorization server that is not an absolute http(s) URL.

## Request identity

A package declares its root module with `defineModule` from `@house-rules/domain`, not from here. `CurrentActor` is this package's per-request slot: `yield* CurrentActor` returns the domain `Actor` directly. The composition's `Caller` sets it per request, and use-cases pass the Actor into module methods. `CurrentActor` carries domain's `PerRequest` marker, so `defineModule` fails `tsc` for a `make` that requires it. Writes still require the use-case's open unit of work; `defineModule` opens none.

## Contract options

| Option | Effect |
| --- | --- |
| `input` | A `Schema.Struct`, a `Schema.Union` of Structs, or `NoInput`. The handler gets the decoded type, one member for a Union. |
| `permission` | `"resource:action"` or `"public"`. Required. Non-public adds `Grant` and `Forbidden`. |
| `needsApproval` | `true` adds `Approval` and `ApprovalDenied`. |
| `transactional` | `true` runs the handler in one unit, adds `UnitOfWork` and `UnitOfWorkFailed`, and removes `NoOpenUnit` from its error type by turning it into a defect. Delete hand-written catches of that error. |
| `annotations` | `readOnly` (call kind `read`, MCP hint) and `destructive`. Both default to `false`. |
| `audit` | `{ target: "<input field>" }`: a string field of the input whose value becomes the call's target id. |

## Use-cases and tests

A use-case is one file under `src/use-cases/` with one `implement(...)` capability and at most one contract.

1. [ ] Give the contract a stable snake_case name, such as `show_booking`. `toTool` uses it as the MCP tool name.
2. [ ] Write the description so it says when an agent should call the tool. Every adapter shows the same text.
3. [ ] Set `annotations.readOnly` on a read and `destructive` on a delete or overwrite; a plain write sets neither. Set `needsApproval: true` where a human must confirm each call, such as delete or share.
4. [ ] An action with no input uses `NoInput`, never `Schema.Struct({})`.
5. [ ] An MCP tool is `tool(capability, { title, idempotent, openWorld })`. All three options are required.
6. [ ] Test with `@effect/vitest` (`it.effect`, `it.layer`), never `Effect.run*`. Cover the good input, the contract's typed error (inspect it with `Effect.flip`), `Grant.denyAll` failing with `Forbidden` before the service runs, and `Approval.denyAll` failing with `ApprovalDenied` when the contract needs approval. For a tool, add an access test: user B cannot read user A's data.

A `Caller` refuses with `new Refused({ status, code, message, challenge })`. The `challenge` goes out as `WWW-Authenticate`; an MCP route names `resource_metadata` in it.

`toMcpHandler` keeps each MCP session in process memory, through Effect's HTTP transport. For the protocol versions clients speak today (2025-03-26 to 2025-11-25) a session needs an `Mcp-Session-Id`. So make the handler once per process (`once`), and run one replica or route each client to the same one. A restart gives clients 404, and they start a new session. A session holds no user data, because the caller runs on every request. Sessions never expire, a small memory leak, because Effect has no public expiry.

## Fixed rules

- It depends on `@house-rules/domain`; domain never imports it. Import each name from the kit that owns it: no re-exports, no aliases.
- `Grant` is action-level authorization and `Approval` is consent. Both are fixed steps of `implement`; only their answers are slots. Object-level authorization is the module's policy, in the domain. `CallWatch` is the only middleware.

- Delivery: a missing view, a view that takes the wrong error, or a service nobody provides is a compile error at `toFetchHandler`, `toMcpHandler` or `call`. A layer error tag without a view is one at `composition()`. Never cast it away; add the view.
- Delivery: a layer that fails to build with a tagged error answers that error's view on every adapter; `call` and the MCP handler resolve, never reject. A dying layer is the fixed 500. The next use builds the layer again, so read `app.runtime` each time instead of keeping it.
- Delivery: requests run as fibers of the app runtime. `app.dispose()` is final: it interrupts running requests, then closes the layer, and never rebuilds it. Later requests answer `CompositionClosed`, 503 `unavailable`, on every adapter.
- Delivery: the success body is the encoded contract output over HTTP and MCP. `call` returns the handler's typed value without encoding.
- Delivery: there is no success view; paging goes in the body, such as `{ items, next }`.
- Delivery: a GET array field takes a repeated key, `status=a&status=b`, and one key is a one-item list. A comma is data. A repeat on any other field, an unknown key and a path key in the query stay 400s. Write a GET default in the contract with `Schema.withDecodingDefaultKey`.
- Delivery: any write that carries a `Cookie`, whatever the caller, from another origin or an opaque one (`null`) is a 403 before the layer builds or the caller runs. A route skips it only with a written `reason`.
- Delivery: the caller runs before input is read or decoded, so refusals do no capability service work. The app layer still builds on the first request, a refused one too. `InputInvalid` never quotes a value. A repeated JSON member, a `__proto__` key and a body that is not valid UTF-8 are 400s. A defect anywhere, a throwing view or an output that does not encode too, is a 500 `internal_error`, logged with the request id. A view may not answer 500: `problem` and `problemView` refuse a literal 500, and a view that answers 500 anyway sends `internal_error` while its body goes to the log.
- Delivery: each handler builds its own router. A fetch handler never answers MCP or another handler's routes.
- Delivery: CORS is an exact origin allow-list and never sends Allow-Credentials. Never add a CORS origin to `origins` to make a call work; a cross-origin page sends a bearer token.
- Delivery: a failure response never names the error's tag or fields. A 4xx carries `x-failure-code` only for a code its view exposes and its endpoint declares, so a view that hides one failure behind another stays hidden.
- `src/contract.ts` is the browser entry. Anything it reaches must stay browser-safe; `contract-entry-is-browser-safe` checks it. Consumer apps trust it by name, so it may import only `effect` modules on the rule's allowlist.

- A handler is an Effect. Expected errors are `Schema.TaggedError` classes. Never `throw`, never `Effect.run*`. The only runs are at an edge: the delivery adapters (`admit`, `call`, the fetch and MCP handlers) and `toPromiseClient`, which turns an Effect into a Promise for a browser. Handlers and capabilities never run one.
- No app calls `Tool.make` by hand. Surfaces come from contracts.
- `toTool` sets `Tool.Strict`: an MCP call with a key the input does not take fails with `InvalidParams`. A Union input decodes through a gate that checks only its keys, then the real Union; MCP sees one merged object. Its JSON `required` errs strict: a key every member has is required unless one member is plainly optional for it on both sides, so a decoding default is still required there. The static `Encoded` type is the merged wire shape and keeps wire-side requiredness.
- A `CallWatch` must return the exit of `run` unchanged.
- The audit target is a field name, never a function. Only a string value is recorded, capped at 256 characters.
- Review rule: `audit.target` names an id field (`tripId`), never free text (title, note). The type cannot prove it: `target: "note"` compiles and stores the note.
- `around` takes `facts` as an optional fourth argument. A watch must handle `undefined` (use `unknownCallFacts(contract)`).
- A capability cannot opt itself out of the watch.
- The request id only traces. It never decides access. Only an id that passes `requestIdOf` (`^[A-Za-z0-9._:-]{1,128}$`) is kept, untrimmed; anything else gets a fresh one, 32 lowercase hex characters.
