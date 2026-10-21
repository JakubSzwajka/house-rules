# @house-rules/application

Application runs features and their declared edges. A feature can be exposed directly. Ways, hooks and schedules start features, never module operations. [Domain](../domain/README.md) owns operation descriptors, callers, kinds and pure graph checks.

```text
HTTP / MCP / call
  way: Who + Mean + exposed features
    feature: watch -> app May -> closures -> approval -> one unit
      handler -> declared edges -> bound operations or other features
                         |
                      step trace
```

## Define a feature

A feature lives in `features/<name>/index.ts`. Import `defineFeature` from the browser-safe contract door. Its handler receives decoded input and `{ call, caller }`. It calls only declared edges, not module services.

The module declares its operation and exports `ItemsOperations` through `@example/items/contract`:

```ts
import { defineOperation } from "@house-rules/domain/contract";
import { Schema } from "effect";

const readTitle = defineOperation("Items.readTitle", {
  description: "Read an item's title.",
  input: Schema.Struct({ id: Schema.String }),
  output: Schema.String,
  failure: Schema.Never,
  permission: "items:read",
  readOnly: true,
});
export const ItemsOperations = { readTitle } as const;
```

`features/show-title/index.ts` contains exactly one builder call and one value export:

```ts
import { ItemsOperations } from "@example/items/contract";
import { defineFeature } from "@house-rules/application/contract";

const readTitle = ItemsOperations.readTitle;
export const showTitle = defineFeature("show_title", {
  description: "Show one item's title.",
  input: readTitle.input,
  output: readTitle.output,
  failure: readTitle.failure,
  permission: null,
  edges: [readTitle],
  flags: { readOnly: true },
  handler: (input, { call }) => call(readTitle, input),
});
```

Keep the endpoint in `ways-in/web/endpoints.ts`:

```ts
import { endpoint } from "@house-rules/application/contract";
import { showTitle } from "../../features/show-title/index.ts";

export const showEndpoint = endpoint(showTitle, "GET /titles/:id");
```

The options are `description`, optional `title`, `permission`, `input`, `output`, `failure`, optional `edges`, `flags`, `start` and `handler`. Permission is a `resource:action` string or explicit `null`. Omitted flags are literal false. `start` defaults to `"person"`. Use `systemStart("hook:first-sign-in")` for a system start. Its optional second argument sets `startedBy`; otherwise the reason supplies both fields.

Export the app's features as one `Features` object in `features/index.ts`. Declare system permissions in composition. Module packages export operation descriptors from their contract doors, often as `<Module>Operations`. Read models also publish operations.

## Bind operations and build the runtime

`bindOperation(operation, handler)` makes a `Binding`. Capture module services during layer acquisition. A bound handler may require only `CallerContext`. Its `CallScope<C>` contains a caller and `ScopedCall<C>` restricted to declared targets. Features already contain their handler and need no binding.

```ts
const bindings = [bindOperation(readTitle, ({ id }) => Effect.succeed(`Title of ${id}`))];
const features = [showTitle] as const;
const layer = Layer.mergeAll(
  Runtime.layer({ bindings, features, ways: [way] }),
  StepTrace.layer(),
);
const app = composition({ layer, features, ways: [way], may: May.fixed(["items:read"]), system: [] });
```

The wiring sketch uses names from the main application door and `Layer` from Effect. Acquire modules, storage, unit, trace and record first. Capture module services and bind operations next. Acquire `Runtime`, then hooks that capture it. The root accepts ways from `main.ts`; it never imports the ways folder.

`Runtime.make/layer` returns typed `GraphInvalid` on cycles, duplicate names or bindings, missing operation bindings, invalid system reasons and duplicate or unregistered exposures. Only `defineFeature` creates a branded feature. Runtime refuses structural forgeries, including spread copies, and recomputes permission closures and lifted flags from the declared graph at acquisition. Feature starts and closure lists are immutable. Composition repeats validation for its actual features and ways against the acquired bindings. Dispatch uses descriptor identity, not name equality.

## Run a feature

`runFeature(feature, input)` returns an Effect with `FeatureFailure<F>` and `FeatureRequirements<F>`. A feature keeps its schemas, edges and identity. `Feature<C, Start>` retains literal lifted flags; `AnyFeature` erases them to booleans for lists.

The `flags` object retains the feature's own literal flags. Its top-level booleans lift across the graph. `readOnly` uses AND; `transactional`, `destructive` and `needsApproval` use OR. A literal nontransactional feature needs no unit service. A system start needs no `CurrentActor`. Widened flags conservatively require transaction and approval services.

Execution opens `CallWatch` once and checks exposed feature identity. For a person start it asks the app's May plug once, after Who, then checks person and system closures. It asks approval once and opens one unit if transactional. Inner calls add trace steps and repeat none of those gates. `featureAndRecheck`, the default policy, also checks each called target's own permission. `featureOnly` skips that recheck. Both keep closure checks.

A plain edge preserves the caller. Domain's `asSystem(target, reason)` switches downward to a system caller. Later system edges preserve the first reason and `startedBy`. Person execution supplies `CurrentActor` from the same Actor. System execution removes ambient person authority. Modules take explicit Actor arguments for object access.

Only this runtime opens a production unit. Writes join it through domain's `UnitOfWork.required`. Memory adapters register undo before mutation. Use domain's `memoryUnitOfWork` or application’s `sqlUnitOfWork`. Unexpected `NoOpenUnit` is a defect inside transactional features and a typed unavailable failure otherwise.

## Open ways and plug sockets

`defineWay({ name, path, features, who, mean, ...protocol })` accepts only features in `features`. Ways carry no permissions. Holding permissions never exposes another way's feature.

Plug May once with `composition({ layer, features, ways, may, system, gatePolicy? })`. `MaySocket<E = never>` has `permissionsOf(caller: PersonCaller): Effect<readonly Permission[], E>`. Capture its long-lived services during mounting. `May.fixed(permissions)` gives every person the same list. A failed lookup is logged and becomes `MayUnavailable`, with fixed public 503 text.

The gate checks the caller's roles through the feature's permission closure. A module checks relations on its loaded object in the same unit as a write. HTTP and MCP share the app May plug. MCP stays read-only by exposing only read features, not by using a separate agent permission list.

`WhoSocket<R>` resolves an Actor from `Incoming`. Composition supplies its requirements. `Mean.no`, `Mean.elicitation` and `Mean.allow` supply lower Approval layers. Elicitation asks a human and fails closed on decline, cancel, malformed replies or missing support. `RecordSocket` supplies lower `CallWatch`; concrete audit storage belongs to call-audit. Authenticator, Approval and CallWatch remain separate slots. There is no export named Record.

HTTP ways hold endpoint descriptors. MCP ways hold tools shaped as `{ feature, title, idempotent, openWorld }`, a server and a protected resource. The router builds MCP tools from feature schemas and lifted flags. MCP verifies bearer admission on every request, including existing sessions. Who must verify signature, issuer, expiry and resource audience. Missing tokens get the metadata challenge. Unset auth returns 503 without a challenge; metadata keeps GET/HEAD/405 behavior. Browser Origins require an exact allowlist.

`toFetchHandler(app)` owns dispatch and metadata routes. Dispose the router before the composition. Builds are lazy, shared after success and retried after failure. Final disposal interrupts inflight work before releasing resources. Closed responses retain request ids and `cache-control: no-store`.

## Endpoints, clients and failures

`endpoint(feature, at?, options?)` defaults to `POST /<feature.name>` and status 200. `defineApi` keeps keyed endpoints for clients. `toHttpClient`, `toPromiseClient` and `toOpenApi` share those descriptors. Clients keep codecs, exact origin guards, manual redirects and request-id reporting. Unknown or undeclared failure headers stay `Unknown`.

Cookie writes require CSRF checks, even before a session cookie exists. Session issue requires token/expiresAt output and never exposes the token in bodies, client types or OpenAPI. Session endpoints forbid GET and CSRF opt-out. Session clear runs on every answer. CORS uses exact origins and never sends Allow-Credentials; it is not access control.

Every expected failure has a domain kind. Statuses are fixed: not_found 404, conflict 409, forbidden 403, unavailable 503, invalid 400. `WordingOverrides` changes messages only. Keep tags, causes, permission details and driver text internal. Plumbing failures use fixed public text; defects get generic 500. Only opted-in 4xx kind codes reach the failure-code header. HTTP and MCP encode outputs once.

`call(app, feature, input, incoming, { way, admitted? })` returns a Promise `Outcome` and supplies Mean.allow. `admit` resolves Who before custom input parsing. Its opaque value belongs to one request, composition and way. Never cache it beyond that request. Hooks use Effect-returning `runFeature` with captured runtime services, `May.system(features, { system: app.system, via })` and approval. They never authenticate again or build another runtime. System starts ignore the person May plug. `May.context(may, { features, system, via, gatePolicy? })` supplies a person-capable in-process context; both helpers keep exposure separate from permissions.

## Trace, registry and doors

`StepTrace.make/layer({ maxRequests? })` defaults to 1000 request buckets. Bounds must be positive safe integers. Eviction is oldest-created first; reads do not allocate or refresh buckets, and finishes do not revive them. Steps retain feature name, target, caller, reason, order and outcome. `CallWatch` writes once per feature start, refusals included. Inner calls never add audit rows.

`Runtime.permissions` is a frozen, sorted list of every unique permission declared by registered operations, including unused bound operations. It excludes null and feature-only permissions. `renderRegistry({ operations, features, ways })` is pure Markdown rendering. It lists the permission catalogue, operations, features, reverse callers, system reasons, closures and exposures. Freshness tests compare without writing.

The contract door exports browser-safe feature builders and types, endpoint/API definitions, clients, session types and schema-only errors. Main adds runtime, bindings, sockets, ways, composition, trace, registry and lower slots. Neither kit owns tables or needs a migration registration. [AGENTS.md](AGENTS.md) lists the mounting rules.

Run package-local `pnpm exec tsc --project tsconfig.json --noEmit` and `pnpm exec varlock run --path ../../ -- vitest run`. Tests use `@effect/vitest`. Unit suites cover memory and real Postgres.
