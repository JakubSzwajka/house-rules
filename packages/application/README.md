# @house-rules/application

Application runs graphs described by [the domain kit](../domain/README.md). Bind a node to its handler, choose an app node as an entry, then expose that entry through a named way. The same entry serves HTTP, MCP and in-process calls.

```text
HTTP / MCP / call
  way: Who + May + Mean
    entry: watch -> closures -> approval -> one unit
      root node -> declared edges -> module nodes
                       |
                    step trace
```

Domain owns descriptors, caller data, kinds and pure graph checks. This kit owns bindings, execution, entries, sockets, ways, the router, clients, trace and registry. It depends on domain, never the other way.

## Bind once, execute through entries

A binding gets decoded input and `{ caller, call }`. It can call only declared edges. Capture module services once when building bindings. `bindNode` allows only `CallerContext` as an ambient per-request requirement.

This small example has a reusable read node and an app entry node:

```ts
import { Actor, ActorId, defineNode } from "@house-rules/domain";
import { Effect, Layer, Schema } from "effect";
import {
  bindNode, composition, defineApi, defineEntry, defineWay, endpoint,
  May, Mean, NodeRuntime, StepTrace, toFetchHandler,
} from "@house-rules/application";

const readTitle = defineNode("Items.readTitle", {
  description: "Read an item's title.",
  input: Schema.Struct({ id: Schema.String }),
  output: Schema.String,
  failure: Schema.Never,
  permission: "items:read",
  readOnly: true,
});
const showTitle = defineNode("show_title", {
  description: "Show one item's title.",
  input: readTitle.input,
  output: readTitle.output,
  failure: readTitle.failure,
  permission: null,
  readOnly: true,
  edges: [readTitle],
});
const entry = defineEntry(showTitle);
const entries = [entry] as const;
const bindings = [
  bindNode(readTitle, ({ id }) => Effect.succeed(`Title of ${id}`)),
  bindNode(showTitle, (input, scope) => scope.call(readTitle, input)),
];
const api = defineApi({ prefix: "/api" }, {
  show: endpoint(entry, "GET /titles/:id"),
});
const way = defineWay({
  name: "web", path: "/api", protocol: "http", entries,
  endpoints: Object.values(api.endpoints),
  who: { resolve: () => Effect.succeed(Actor.make({ id: ActorId.make("demo") })) },
  may: May.fixed(entries, ["items:read"]),
  mean: Mean.no,
});
const layer = Layer.mergeAll(
  NodeRuntime.layer({ bindings, entries, ways: [way] }),
  StepTrace.layer(),
);
const app = composition({ layer, entries, ways: [way], system: [] });
const handler = toFetchHandler(app);
```

Split this sketch into the app's checked folders:

- Put app descriptors in `features/<name>/node.ts` and bindings in `handler.ts`.
- Put reusable module descriptors in package contract doors. Export binders that capture the module service.
- Put ways in `ways-in/<name>/` and wiring in `composition/`.

Only app nodes become entries. Their source location proves ownership; descriptors have no place marker. Domain modules are packages, never app folders. Ways may import package contract values, but only types from other package main entries. Build concrete plugs in composition and pass them to ways.

`NodeRuntime.make/layer` fails with typed `GraphInvalid` during acquisition for invalid graphs, missing reachable bindings, duplicate bindings or duplicate exposures. Composition validates its actual entries and ways against that binding set again. Descriptor identity is the dispatch identity, so a different object with the same name is not a substitute.

## Entry gates and caller modes

`defineEntry(node)` starts as a person. An optional `features/<name>/entry.ts` imports it by name from `@house-rules/application/contract`. That file imports only its own node.ts and the application contract door, including type imports. It exports one direct const Entry. Ways, endpoints, hooks, schedules and composition share that value. Its closures come from the graph. The person closure stops at system edges; the system closure includes every permission below them. `defineEntry(node, { start: systemCaller })` puts the whole graph in the system closure.

Flags lift from every reachable node. `readOnly` is true only if all nodes read only; `destructive`, `transactional` and `needsApproval` are true if any node has that flag. `Entry<N, Start>` retains those literal types. Read-only entries need no unit slot; a system start needs no `CurrentActor`. For a genuinely widened node, types conservatively require transaction and approval. `AnyEntry` is an erased boolean-flag container for lists, not proof of concrete flags.

`runEntry(entry, decodedInput)` returns an Effect with `EntryFailure<E>` and `EntryRequirements<E>`. The watch opens first, even for a gate refusal. Entry identity is checked before either closure. Person permissions are checked before system permissions, then approval runs once, then one unit opens if needed. Nodes run inside that work. Inner calls repeat none of those entry steps.

The default `entryAndRecheck`, `"entry-and-recheck"`, also checks each called node's own permission. `entryOnly`, `"entry-only"`, skips that recheck. Keep the choice explicit until P2 is settled. Both policies still require the entry closures. A missing permission produces `Forbidden({ entry, permission, caller })` with the real permission, never an invented entry permission.

`CallerContext` holds domain's `PersonCaller | SystemCaller`. A person binding sees the same Actor through `scope.caller.actor` and `CurrentActor`. On the first `asSystem` edge, the runtime sets `startedBy` to `<entry> · <actor.id>`. All descendants retain that system caller and reason, even across later system edges. System bindings cannot inherit an ambient person's `CurrentActor`.

Modules keep explicit Actor arguments and object policies. Only the entry runtime opens a production unit. Modules, feature handlers, read models and composition never call `UnitOfWork.atomic`. Module writes join the open unit through domain's `UnitOfWork.required`; memory adapters register undo through `onRollback` before mutation. Application supplies `sqlUnitOfWork` for Postgres. Domain supplies `memoryUnitOfWork`. Atomic entries treat unexpected `NoOpenUnit` as a defect; plain entries keep it as a typed unavailable error.

## Sockets and ways

| Socket | Plug |
| --- | --- |
| `WhoSocket<R>` | `{ resolve: incoming => Effect<Actor, Refused, R> }`; concrete auth and identity packages own verification and actor lookup |
| `MaySocket` | `May.fixed(entries, personPermissions)` or `May.system(entries)` |
| `MeanSocket` | `Mean.no`, `Mean.elicitation`, `Mean.allow`, each with an Approval layer |
| `RecordSocket<E, R>` | `{ layer }` over lower `CallWatch`; concrete `CallAudit.record.memory/postgres` lives in call-audit |

There is no export named `Record`. Lower `Authenticator`, `Approval` and `CallWatch` remain separate slots. `CallWatch` defaults to pass-through and adds no required service. Its `around(entry, input, work, facts?)` must return the work's exit unchanged. Recording must not turn a failed write into a success or replace its failure.

A way has `name`, `path`, `entries`, `who`, `may`, `mean` and optional message overrides. HTTP adds `protocol: "http"`, endpoint descriptors and transport options. MCP adds `protocol: "mcp"`, server name/version, tool hints, a `ProtectedResource` and optional `allowedOrigins`. That list admits exact browser Origins; without it, requests with an Origin are refused. Requests without Origin remain allowed after bearer admission. A tool entry is `{ entry, title, idempotent, openWorld }`; its description and lifted read/destructive hints come from the entry node.

May's entry set must equal the way's exposed set by identity. HTTP endpoints and MCP tools must refer to those entries. A way cannot invoke another way's entry merely by holding its permissions. Names, paths, route addresses and exposure duplicates are checked during acquisition.

`composition({ layer, entries, ways, system, gatePolicy? })` takes one system permission list and the complete root layer. It checks unmet entry and Who services at compile time. The root should read in this order:

```text
modules / storage / unit / trace / record
  -> capture module services and build bindings
  -> NodeRuntime.layer
  -> acquire hooks that capture the runtime
  -> final lower auth slots
  -> composition
```

Pass way values or a way factory into the root from `main.ts`; the root never imports the app's ways folder. A hook must not force construction of a second runtime or make module acquisition depend on per-request identity.

## HTTP and MCP behavior

`toFetchHandler(app)` builds one router for all ways and each MCP resource's metadata paths. The app writes no path-dispatch chain. The callable also has `dispose()`. Dispose that router before `app.dispose()`, then close the Host. A composition builds lazily, shares a successful build, retries a failed build and interrupts inflight requests before releasing its layer. Disposal is final; later calls get `CompositionClosed`. Post-dispose router responses keep the request id and `cache-control: no-store`.

HTTP way options are `origins`, `cors`, `session` and `maxBodyBytes`. Body limit defaults to 1 MiB. Input validation rejects unknown/repeated keys, malformed JSON, invalid UTF-8 and duplicate path/query/body keys without quoting the input value. GET arrays use repeated keys; commas remain data. Union inputs retain their member codecs and required fields. Admission happens before parsing input.

`cors: { origins, maxAge? }` is an exact http(s) origin list, with a 600-second preflight default. Listed origins get Allow-Origin and exposed request-id/failure-code headers. No Allow-Credentials is sent. Unlisted ordinary requests still run without CORS headers; CORS is not access control. CSRF separately guards every cookie write. An opaque origin never passes. With no configured origins, the request URL's origin is used.

MCP authenticates every request, including requests in an existing session. The kit requires a bearer header; the Who plug must verify signature, issuer, expiry and this resource's audience before returning an Actor. Invalid/missing tokens get protocol 401 with `WWW-Authenticate` naming `resource_metadata`. Unconfigured auth gets 503 `not_configured` without a challenge. Metadata supports GET and HEAD, and rejects other methods with 405. Sessions remain in process memory, so use one replica or sticky routing. They hold no user authority; Who runs again for each request. Effect exposes no session expiry, so sessions remain until process exit.

MCP parameters are validated by the router's strict toolkit before the binding runs. Decoded inputs go straight to the entry: re-encoding would lose values for omit-default codecs. The toolkit alone encodes the decoded output with its JSON codec, once, just as HTTP encodes its response once. The transport may default omitted arguments to `{}`; explicit null, primitives, arrays and missing required node fields stay refused. Elicitation asks a human with a field-less form. Decline, cancel, malformed replies, missing support and failed requests all fail closed. Decision logs contain no input.

## Shared endpoints and clients

`endpoint(entry, at?, options?)` returns a browser-safe `Endpoint` with `.entry`. The default address is `POST /<entry.node.name>`, status 200, no failure codes and no session. Options are `status`, `codes`, `session` and `csrf`. `defineApi({ prefix? }, endpointsByKey)` keeps the keyed list for a Promise client. A way uses the same prefix; it never concatenates two prefix owners. OpenAPI can derive that prefix or verify the same explicit one.

A CSRF opt-out is `{ skip: true, reason }`, with a nonblank reason. Session endpoints cannot opt out or use GET. `session: "issue"` requires a Struct output containing `token` and `expiresAt` in epoch milliseconds. The token goes only into an HttpOnly, SameSite=Lax cookie; the body, client type and OpenAPI omit it. Secure is set for HTTPS, a trusted HTTPS Origin behind a proxy, or a `__Host-`/`__Secure-` name. `session: "clear"` clears the cookie even on failure. The way needs `session: { cookie }`. Session writes need CSRF protection even before a cookie exists.

- `toHttpClient(endpointArray, { prefix?, baseUrl? })` returns name-keyed Effect calls requiring `HttpClient`.
- `toPromiseClient(api, { baseUrl?, token?, onCall?, fetch? })` returns keyed Promise calls and reports method, path, status, duration, code and safe response request id.
- `toOpenApi(endpoints, { title, version, prefix?, security? })` derives kind responses. Configured security applies to every endpoint, even a permission-null root, because every way runs Who. Wording belongs to ways, not OpenAPI. Lifted flags add `x-house-rules-read-only` and `x-house-rules-destructive` only when true.

Clients encode typed inputs and decode outputs. Base URLs must be absolute http(s) URLs without credentials, query, fragment, controls or backslashes. With no base, they use the page's http(s) origin; with neither they send nothing. Paths and parameter values cannot escape that origin. Redirects are manual, preserving other fetch options. The Promise client does not propagate tracing headers. Explicit downstream URL rewrites or `HttpClient.followRedirects` opt out of these protections.

## Kinds, wording and admission

Declare error kinds at their domain definitions with `kind: errorKind(...)`. The status and public code come only from the kind:

| Kind | Status |
| --- | --- |
| `not_found` | 404 |
| `conflict` | 409 |
| `forbidden` | 403 |
| `unavailable` | 503 |
| `invalid` | 400 |

`WordingOverrides<Failure>` accepts known error tags mapped to `(error) => string`. It changes only the message, with no caller context. Status, code, body and headers cannot be replaced. Responses contain only kind code and message, not tags or arbitrary error fields. User-facing app/module errors keep their default message. Unavailable errors use fixed public text; causes and driver details stay internal. Kit errors use fixed public wording: Forbidden says `You may not use <entry>.`; ApprovalDenied says `This action was not approved.`; unit, SQL, graph, node-call and closed-composition failures say `Try again shortly.` The error values keep their details for internal use. Message overrides run on top of these defaults. A defect or failed override gets the fixed generic 500. Auth and framing failures keep their protocol responses. A node that fails with `Refused` still gets the kind's status and code, not a custom transport view.

Only a kind code in an endpoint's `codes` list can appear in `x-failure-code`, and only on 4xx. A 5xx never discloses it. Clients treat undeclared, foreign and legacy headers as `HttpFailure` code `Unknown`. Input failures still carry `entry`, `field`, `issue`, `message` and kind internally for typed wording.

`call(app, entry, decodedInput, incoming, { way, admitted? })` returns a Promise `Outcome` without encoding its output. It validates the decoded input type, avoiding a lossy encode/decode round trip. The in-process action supplies Mean.allow. There is no caller or approval override.

`admit(app, incoming, { way, channel? })` runs Who before custom input parsing. Its opaque `Admitted` can be reused for several entries in the same request on the same composition and way. It keeps Actor, channel and request id and never authenticates again. Do not cache it: it has no expiry and would outlive token revocation. Cross-composition or cross-way reuse is refused. Entry exposure and closure gates still run on every call.

## Hooks, trace and registry

Hooks and schedules use `defineEntry(node, { start: systemCaller })` and Effect-returning `runEntry`. Capture runtime, trace, unit and watch once, then supply `May.context(May.system([entry]), { system, via })` and approval. Do not call Promise-returning `call` or authenticate again inside a hook.

`CallFacts` includes read/write kind, entry-name `target`, optional object `targetId` (null by default), channel and request id. Node input text is never copied into the audit target. `CallChannel` and `CallRequestId` are defaulted references. MCP takes its channel from the client name, capped at 40 plain characters. `withRequestId` sets the reference and log annotation. `requestIdOf` accepts only 1..128 plain id characters; otherwise the edge generates 32 lowercase hex characters and echoes them.

`StepTrace.make/layer({ maxRequests? })` defaults to 1000 request buckets. Bounds must be positive safe integers; both constructors throw `RangeError` synchronously at wiring time otherwise. Valid layers allocate their state lazily per build. A new bucket evicts the oldest-created bucket, not the least-read one. Unknown reads allocate nothing; unknown finishes revive nothing. Steps have entry, target, caller, system reason, order and outcome. Refusals record the real missing permission. Snapshots are copies; null is one shared fallback bucket for runners that supplied no id.

`renderRegistry({ nodes, entries, ways })` returns deterministic Markdown with reverse callers, system reasons, entry modes/closures and exposures. It runs no app services. A registry script writes the result; a freshness test only compares it.

## Doors and verification

Install exact application 0.2.0, domain 0.1.0 and Effect 4.0.3. The published packages load built `dist/` files. This workspace reads source. No migration entry is needed for either kit.

Browser code imports `@house-rules/application/contract`: defineEntry, Entry/Endpoint/Api definitions, session/body types, clients and schema-only kit errors. It imports node descriptors and kinds from `@house-rules/domain/contract`. Bindings, runtime, sockets, ways and composition stay behind the main door. [AGENTS.md](AGENTS.md) records the final API and fixed rules.

Run `pnpm --filter @house-rules/application typecheck` and `pnpm --filter @house-rules/application test`. Tests use public kit doors and `@effect/vitest`; codec/property cases run against the actual MCP router, and unit suites run on memory and real Postgres.
