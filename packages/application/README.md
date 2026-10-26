# @house-rules/application

Application runs feature and read-model entry points and their declared operation edges. A feature can be exposed directly. Network, hook, schedule and event ways start either entry-point kind, never module operations. [Domain](../domain/README.md) owns operation descriptors, callers, kinds and pure graph checks.

```text
HTTP / MCP / call
  way: Who + Mean + exposed features
    feature: watch -> app May -> closures -> approval -> one unit
      handler -> declared edges -> bound operations only
                         |
                      step trace
```

## Define a feature

A feature lives in `features/<name>/index.ts`. Import `defineFeature` from the browser-safe contract door. Its handler receives decoded input and `{ call, caller }`. It calls only declared operation edges, never other features or module services. `feature-file` rejects imports of other feature indexes. Typed feature edge targets fail at compile time; Runtime/composition acquisition rejects plain and system feature targets with typed GraphInvalid. Reuse goes through module operations.

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

Export the app's features as one `Features` object in `features/index.ts`. Declare system permissions in composition. Module packages export operation descriptors from their contract doors, often as `<Module>Operations`. Projections publish operations. Read models are exposed queries, not mounted services.

## Define a read model

`defineReadModel` is the read entry-point builder from application/contract. Its `kind` is `"read-model"`; defineFeature retains `"feature"` for commands, including idempotent commands and legacy read-only features. Names, verbs and readOnly never classify kind.

Put one builder call with schemas and handler in `read-models/<name>/index.ts`, then export ReadModels from `read-models/index.ts`. The options match defineFeature, except own readOnly is fixed true and destructive may only be false. Transactional reads are supported. Edges accept read-only operation descriptors only, including system edges. Runtime and plan validation reject every declared transitive path into non-read-only work. Domain calculations remain in modules; SQL is not required.

```ts
import { defineReadModel } from "@house-rules/application/contract";
import { ItemsOperations } from "@example/items/contract";
export const showTitle = defineReadModel("show_title", {
  description: "Show one title.", permission: null,
  input: ItemsOperations.readTitle.input, output: ItemsOperations.readTitle.output,
  failure: ItemsOperations.readTitle.failure, edges: [ItemsOperations.readTitle],
  handler: (input, { call }) => call(ItemsOperations.readTitle, input),
});
```

Register `[...Object.values(Features), ...Object.values(ReadModels)]` in composition's existing `features` field. Ways, endpoint, clients, May and runFeature accept either branded kind. Feature and ReadModel retain literal flags; AnyEntryPoint is the shared list type. AnyFeature remains command-only. There is one executor, including identity checks, admission, validation, refusal audit, closures, approval, units and trace. No entry-to-entry edges or pass-through feature wrappers are allowed.

SQL query services are **projections**, in `projections/<name>/`. They keep their service/operations/binder mount, contracts and adapters. Use map kind `"projection"`; old mount kind `"read-model"` remains accepted as a legacy projection. Published-view SQL ownership, parameter proof, A/B tests and unavailable ports are unchanged. Projection contracts, never services/adapters, may be imported by entry points. Ways may import read-model indexes/registry, not projection values.

Graph validation proves declared read-only reachability. It trusts operation metadata. Import/type/lint fences do not prove arbitrary JavaScript purity, and SQL tests do not provide a production SELECT-only database role.

### Migrate an exposed read

When upgrading to rules that enforce this layout, move legacy SQL/service folders under `src/read-models/` to `src/projections/`. Runtime compatibility for the old mount kind `read-model` is retained, but the new authoring rules reject SQL projection code in `read-models/`.

1. Keep its name, input/output/failure schemas, permission, edges and handler. Move it to read-models/<name>/index.ts and use defineReadModel. Keep command features, even idempotent ones, unchanged.
2. Move any old SQL/service mount out of read-models into projections. Update its contracts, composition mount imports and map kind, without changing domain logic or SQL.
3. Add the query to ReadModels and register/expose that exact descriptor directly. Update endpoint imports and remove only its old wrapper feature. Keep existing features/exposure field names and endpoint methods/paths.
4. Set kind read-model on its plan features entry, update paths and regenerate the map. Old missing kinds default to feature, never an inferred query. Widen generic consumer lists from AnyFeature to AnyEntryPoint only when they contain both kinds.
5. Prove caller A/B access, refusal audit, identity and schemas, then require an empty built/plan diff and passing check/test before adoption.

## Bind operations and build the runtime

`bindOperation(operation, handler)` makes a `Binding`. Capture module services during layer acquisition. A bound handler may require only `CallerContext`. Its `CallScope<C>` contains a caller and `ScopedCall<C>` restricted to declared targets. Features already contain their handler and need no binding.

```ts
const modules = {
  mounts: [{ ...ItemsMount, layer: itemsLayer }],
  layer: Layer.merge(memoryUnitOfWork, StepTrace.layer()),
};
const app = composition({ modules, features: [showTitle], ways: [way],
  may: Effect.succeed(May.fixed(["items:read"])), system: [] });
```

A package main exports a plain `<Module>Mount` value satisfying `MountDefinition<I, S>`: `{ service: Context.Key<I, S>, operations, bind: (service: S) => readonly Binding[] }`. Projections export theirs from index. Only modules.ts chooses a mount's layer. `ModuleMount` adds that layer; `ModulePlan` pairs the mount tuple with shared infrastructure and optional map-only `plugs`. Each layer must provide its mount's service. The kit checks each binder parameter against its service shape.

`planLayer(plan)` builds raw services from the same plan used by composition. It merges the mount layers, provides shared infrastructure and supplies PermissionCatalogue from the mount descriptors before either builds. Its Layer retains the plan's outputs, errors and uncovered inputs. Use it for service-level tests and tooling, not a second app assembly path. It never calls binders or installs way plugs.

Composition supplies the kit-owned PermissionCatalogue before building modules, then acquires mount services and infrastructure in one memoization scope. It calls each binder once, acquires Runtime, resolves the effectful May, installs hook slots and starts scoped schedule clocks. Standalone `Runtime.layer({ mounts, features, ways })` requires the services but does not build mount layers. The root accepts ways from `main.ts`; it never imports the ways folder.

`Runtime.layer` returns typed `GraphInvalid` on duplicate service keys, operation identities or names, missing/extra/duplicate binder descriptors, cycles, invalid system reasons and duplicate or unregistered exposures. Only `defineFeature` and `defineReadModel` create branded entry points with explicit feature/read-model kinds. Runtime refuses structural forgeries, including spread copies, and recomputes permission closures and lifted flags from the declared graph at acquisition. Feature starts and closure lists are immutable. Composition repeats validation for its actual features and ways against the acquired bindings. Dispatch uses descriptor identity, not name equality.

## Run a feature

`runFeature(feature, input)` returns an Effect with `FeatureFailure<F>` and `FeatureRequirements<F>`. A feature keeps its schemas, edges and identity. `Feature<C, Start>` retains literal lifted flags; `AnyFeature` erases them to booleans for lists.

The `flags` object retains the feature's own literal flags. Its top-level booleans lift across the graph. `readOnly` uses AND; `transactional`, `destructive` and `needsApproval` use OR. A literal nontransactional feature needs no unit service. A system start needs no `CurrentActor`. Widened flags conservatively require transaction and approval services.

Execution opens `CallWatch` once and checks exposed feature identity. For a person start it asks the app's May plug once, after Who, then checks person and system closures. It asks approval once and opens one unit if transactional. Inner calls add trace steps and repeat none of those gates. Every inner call rechecks its own permission against the permissions loaded at feature start.

A plain edge preserves the caller. Domain's `asSystem(target, reason)` switches downward to a system caller. Later system edges preserve the first reason and `startedBy`. Person execution supplies `CurrentActor` from the same Actor. System execution removes ambient person authority. Modules take explicit Actor arguments for object access.

Only the feature runtime and kit-owned event driver open production units. Writes join it through domain's `UnitOfWork.required`. Memory adapters register undo before mutation. Use domain's `memoryUnitOfWork` or application’s `sqlUnitOfWork`. Unexpected `NoOpenUnit` is a defect inside transactional features and a typed unavailable failure otherwise.

## Open ways and plug sockets

`defineWay({ name, path, features, who, mean, ...protocol })` accepts either branded entry-point kind in the shared `features` field. Ways carry no permissions. Holding permissions never exposes another way's feature.

Plug May once with `composition({ modules: ModulePlan, features, ways, may, system })`. Pass an Effect such as Party.may(); composition resolves it after modules build, with no mutable cell. `MaySocket<E = never>` has `permissionsOf(caller: PersonCaller): Effect<readonly Permission[], E>`. Capture its long-lived services during mounting. `May.fixed(permissions)` gives every person the same list. A failed lookup is logged and becomes `MayUnavailable`, with fixed public 503 text.

The gate checks the caller's roles through the feature's permission closure. A module checks relations on its loaded object in the same unit as a write. HTTP and MCP share the app May plug. MCP stays read-only by exposing only read features, not by using a separate agent permission list.

`WhoSocket<R>` resolves an Actor from `Incoming`. Composition supplies its requirements. `Mean.no`, `Mean.elicitation` and `Mean.allow` supply lower Approval layers. Elicitation asks a human and fails closed on decline, cancel, malformed replies or missing support. `RecordSocket` supplies lower `CallWatch`; concrete audit storage belongs to call-audit. Authenticator, Approval and CallWatch remain separate slots. There is no export named Record.

HTTP ways hold endpoint descriptors. List public features with `defineWay({ protocol: "http", ..., features: [Features.signIn, Features.profile], public: [Features.signIn] })`. Each public feature must also be in `features` and declare `start: systemStart(reason, startedBy?)`. Composition and Runtime reject person-start or unexposed public entries with GraphInvalid. Only listed requests skip Who, ignoring missing, invalid and valid tokens alike. They run as the declared SystemCaller using composition's system permissions. Watch, approval, transactions, trace and transport guards still apply. Other features still resolve Who. MCP refuses `public`.

Admission stays on the way, not on endpoint descriptors. Pass `public: way.public` to `toOpenApi(endpoints, options)` to mark those operations with `security: []`, overriding any global security requirement. This option only describes admission; it cannot grant access. The router has no HTTP documentation route.

MCP ways hold tools shaped as `{ feature, title, idempotent, openWorld }`, a server and a protected resource. The router builds MCP tools from feature schemas and lifted flags. MCP verifies bearer admission on every request, including existing sessions. At feature execution, every network way removes the ambient HTTP request and strips Authorization, Cookie, Proxy-Authorization and Set-Cookie from CallerScope.incoming.headers. Network feature handlers and inner operations cannot recover credential headers from those request services through Effect.context(). Hooks, schedules and events instead use a fresh allowlist context built from composition-captured execution services, with no caller-provided services or network request context. Transport, Who, CSRF/origin checks and session handling retain the full request. Request ids, MCP sessions and elicitation keep their protocol context. Who must verify signature, issuer, expiry and resource audience. Missing tokens get the metadata challenge. Unset auth returns 503 without a challenge; metadata keeps GET/HEAD/405 behavior. Browser Origins require an exact allowlist.

`toFetchHandler(app)` owns dispatch and metadata routes. Dispose the router before the composition. Builds are lazy, shared after success and retried after failure. Final disposal interrupts inflight work before releasing resources. Closed responses retain request ids and `cache-control: no-store`.

## Hook and schedule ways

```ts
const hook = defineWay({
  protocol: "hook", name: "new-login", slot: FirstSignInSlot,
  features: [Features.firstSignIn], mean: Mean.allow,
  input: (principal) => ({ issuer: principal.issuer, subject: principal.subject,
    displayName: principal.subject }),
  failure: () => new Refused({ status: 503, code: "sign_in_failed", message: "Try again." }),
});
const nightly = defineWay({
  protocol: "schedule", name: "nightly-cleanup",
  clock: { cron: "0 3 * * *", timeZone: "UTC" },
  features: [Features.duePayments, Features.expirePayment], mean: Mean.allow, input: {},
});
```

Both variants accept system-start entry points only. A hook has exactly one feature. Its caller-owned slot runs on a fresh context containing only composition-captured Runtime, StepTrace, UnitOfWork, CallWatch, the way's Approval, CallPermissions from May.system with the composition gate policy, and CallChannel. Hooks and schedule executions add fresh request ids, fresh log annotations and new root spans. Caller-provided services, log annotations and current spans are not inherited. Every hook invocation uses the hook:<name> channel; schedules use schedule:<name>. Neither calls Who or inherits CurrentActor or network request context. Hook results and mapped errors return to the slot caller; caller interruption still interrupts the hook. Internal causes are logged; only the mapped error reaches the slot. Duplicate slot providers fail GraphInvalid.

A schedule's selector output must be an array of item inputs. Composition parses its UTC cron and checks its next date at acquisition; invalid or impossible clocks fail GraphInvalid. Later next-date failures are also typed GraphInvalid, logged before the driver stops. Scoped drivers start after hooks and first wait for the next tick. Each tick runs the selector, then each item sequentially through runFeature, one unit per transactional item. Item failures are logged and processing continues. There is no startup run, catch-up or distributed lease. Item operations must be idempotent. Disposal interrupts the driver before closing infrastructure. System ways have no path, Who, endpoints or tools, and never enter fetch routing.

Mean is explicit. Trusted provisioning and nightly maintenance use Mean.allow; other system ways use Mean.no unless approved. For TestClock tests, supply the test Clock through the module plan's infrastructure. ManagedRuntime does not inherit ambient test services. Registry scripts use a frozen TestClock layer so acquisition cannot run scheduled work. Registry output includes hook slot keys and schedule clocks.

## Event ways

```ts
const events = defineWay({
  protocol: "event", name: "notifications", on: ["task_moved"],
  feature: Features.notifyTaskMoved, mean: Mean.no,
});
```

The handler feature declares `start: systemStart(reason, "event:notifications")` and uses `EventInput` from application/contract as its input schema. `EventInput` is `{ event: EventEnvelope, causedBy: string | null }`. The full envelope contains `id`, `kind`, `subject: { kind, id }`, decoded `payload`, nullable `scopeId`, nullable `actorId`, epoch-millisecond `occurredAt` and nullable `requestId`. Narrow payloads in the app's event schema when needed. `causedBy` copies `actorId`. It is an identifier, not an Actor, and grants no authority. Event trace steps retain it as data.

Application owns the `EventSource` Context service, not event-log. Its port supplies consumer coverage, opaque delivery tokens from `claimDue(consumer)`, `takeNext(token)`, `settleSuccess(token)`, `settleFailure(token, safeSummary)` and a `wake` stream. Every method joins the driver's current unit. Sources own retry, backoff and dead-letter policy. EventLog.source is one plug; see [event-log mounting](../event-log/README.md#mount). An app without event ways needs neither EventSource nor event-log.

A way name is its consumer name. Acquisition fails with GraphInvalid for duplicate way/consumer names, a missing source, non-system features, or any difference between `on` and the consumer's kinds. Mean is mandatory. No network fields are allowed. The source must report only due deliveries. Composition starts one scoped driver per event way after hooks. It merges source wakes with a periodic sweep, default 30000ms, configurable through `composition({ ..., eventSweepMs })` with a positive integer. It drains due tokens at startup and after wakes, without inventing missed work. Listener failures log and restart after the sweep interval. The source port does not report the next retry time. A retry runs on the first wake or sweep at or after its deadline, not necessarily at that deadline.

```text
claim due in its own unit -> COMMIT attempt + retry deadline
  per token, one new unit:
    take -> runFeature(system feature, { event, causedBy }) -> settle success
  failure -> ROLLBACK -> settle failure in a separate unit
```

A transactional feature joins that delivery unit. A failed feature cannot erase the committed attempt. Failures log and delivery continues; the source decides when to retry or dead-letter. Each execution uses May.system, a fresh request id, the `event:<way>` channel and a new root span. It inherits no person, request services or network context. Disposal stops drivers before resources close. Handlers must be idempotent because delivery is at least once.

Maps show the event kinds beside the handler feature in text, HTML, Mermaid and JSON; diffs compare `on`. Plans use `{ name, protocol: "event", on: ["task_moved"], features: ["notify_task_moved"], mean: "no" }`. They require exactly one system-start feature, distinct nonblank kinds and an explicit Mean, and reject public/MCP fields. Source coverage is checked only by real acquisition, not by the plan.

## Endpoints, clients and failures

`endpoint(feature, at?, options?)` defaults to `POST /<feature.name>` and status 200. `defineApi` keeps keyed endpoints for clients. `toHttpClient`, `toPromiseClient` and `toOpenApi` share those descriptors. Clients keep codecs, exact origin guards, manual redirects and request-id reporting. Unknown or undeclared failure headers stay `Unknown`.

Cookie writes require CSRF checks, even before a session cookie exists. Session issue accepts a Struct or Union of Structs with at least one token/expiresAt member. Only token-bearing values set a cookie. Tokenless values return 200 without a cookie. `SessionOption` permits issue for such unions; `BodyOf` omits token separately from every member, as do body schemas, client types and OpenAPI. Session endpoints forbid GET and CSRF opt-out. Session clear runs on every answer. CORS uses exact origins and never sends Allow-Credentials; it is not access control.

Every expected failure has a domain kind. Statuses are fixed: not_found 404, conflict 409, forbidden 403, unavailable 503, invalid 400. `WordingOverrides` changes messages only. Keep tags, causes, permission details and driver text internal. Plumbing failures use fixed public text; defects get generic 500. Only opted-in 4xx kind codes reach the failure-code header. HTTP and MCP encode outputs once.

`call(app, feature, input, incoming, { way, admitted? })` returns a Promise `Outcome` and supplies Mean.allow. `admit` resolves Who before custom input parsing. Its opaque value belongs to one request, composition and way. Never cache it beyond that request. Hooks use Effect-returning `runFeature` with captured runtime services, `May.system(features, { system: app.system, via })` and approval. They never authenticate again or build another runtime. System starts ignore the person May plug. `May.context(may, { features, system, via })` supplies a person-capable in-process context; both helpers keep exposure separate from permissions.

## Trace and app map

`StepTrace.make/layer({ maxRequests? })` defaults to 1000 request buckets. Bounds must be positive safe integers. Eviction is oldest-created first; reads do not allocate or refresh buckets, and finishes do not revive them. Steps retain feature name, target, caller, reason, order and outcome. `CallWatch` writes once per feature start, refusals included. Inner calls never add audit rows.

`Runtime.permissions` is a frozen, sorted list of every unique permission declared by registered operations, including unused bound operations. It excludes null and permissions declared only by features. The kit-owned PermissionCatalogue has `{ permissions: () => Effect<readonly Permission[]> }` and exposes that same array before modules build.

`appMap(app): Effect<AppMapSnapshot, E | CompositionClosed | GraphInvalid>` acquires the validated app and snapshots its mounts, registered features and actual ways as plain serialisable data. `renderMap(snapshot, "text" | "json" | "mermaid" | "html")` is pure and sorts each collection using code-point order. It includes mounted operations with `readOnly`, `destructive`, `transactional` and `needsApproval` from their descriptors, feature flags and closures, declared edges, exposures, public features and permission owners. Known Mean values are named by identity. It neither runs features nor reads files. New maps emit operation edges only; decoding keeps the legacy feature edge kind for old snapshots. Mounts can declare `map: { name, kind: "package" | "projection" | "read-model", role?: "capability" | "process", package? }`; role defaults to capability and is emitted on each snapshot module. Older snapshots without role also mean capability; without metadata, the fallback name is the service key's last segment and the kind defaults to package. Resolve source ownership before publishing that fallback. Tooling can attach source paths with `appMapSources` from `@house-rules/rules/app-map`, which matches literal builder names to registry imports and package/read-model sources and rejects missing or ambiguous facts. The layers header is fixed and labels that limit. Use memory adapters and a frozen clock for reproducible acquisition. Install a fixed ConfigProvider inside the module plan with `Layer.provideMerge`, so infrastructure and mounted layers use it. Wrapping the caller alone does not configure the composition's separate ManagedRuntime. Text output marks final children with `└─` and wraps lists at 100 columns with aligned continuation lines, keeping identifiers intact. The app map script writes `MAP.md`; its freshness test compares without writing.

Text lists capability packages under MODULES and process modules under PROCESS MODULES. HTML and Mermaid group process modules separately, with the real operation edges. Modules are marked framework when their package starts with `@house-rules/`, otherwise app-owned. A process composes modules through operation edges; it may be stateless or durable. Capability modules keep their own state, computation or outside effects and their rules.

### Plugs

`snapshot.plugs` lists `{ name, package?, fills, ways? }`, sorted by name, and text renders it as PLUGS. `fills` is `Who`, `May`, `Mean`, `Record`, `Authenticator`, `ActorResolver`, `Approval`, `CallWatch`, `EventSource` or the slot key of a hook way. appMap derives two kinds: `Mean.allow`, `Mean.no` and `Mean.elicitation` by identity with their ways, and `hook:<way>` for each hook way's slot. A Who value, the May Effect and a record layer carry no name, so the app declares them on its ModulePlan:

```ts
plugs: [
  { name: "Identity.who", package: "@house-rules/identity", fills: "Who", ways: ["mcp", "web"] },
  { name: "Party.may", package: "@house-rules/party", fills: "May" },
  { name: "CallAudit.record", package: "@house-rules/call-audit", fills: "Record" },
],
```

Declared plugs are review facts. No runtime code reads them and the runtime does not prove them; review and the pull-out test catch a wrong name. appMap fails with GraphInvalid when a declared plug has a blank or duplicate name, fills an unknown socket or slot, names an unknown or repeated way, puts Who on a hook or schedule way, omits ways for Who, Mean or a hook slot, names ways for May, Record or EventSource, differs from a derived plug of the same name, uses the reserved `hook:` prefix without matching a hook way, or fills a socket or slot twice on one way or app. appMap reports only the first plug issue it finds; `validatePlan` reports every plug issue together. A declared plug identical to a derived one merges into it.

Socket fills and hook slot fills are separate, so a hook whose Context key is `Mean` never collides with the Mean socket. In a valid map only a `hook:<way>` plug fills a slot; every other plug fills the socket named by `fills`. A declared plug that is not a derived twin fills the socket when `fills` names one.

The contract door exports browser-safe feature builders and types, endpoint/API definitions, clients, session types and schema-only errors. Main adds runtime, bindings, sockets, ways, composition, trace, app map and lower slots. Neither kit owns tables or needs a migration registration. [AGENTS.md](AGENTS.md) lists the mounting rules.

Run package-local `pnpm exec tsc --project tsconfig.json --noEmit` and `pnpm exec varlock run --path ../../ -- vitest run`. Tests use `@effect/vitest`. Unit suites cover memory and real Postgres.

## See a map or a change as a page

`renderMap(snapshot, "html")` returns one self-contained HTML document: inline CSS and script, no network, and the same bytes for the same snapshot. It shows ways in, features and operations grouped by module and projection, left to right. Hook, schedule and event ways sit under System. Operations and features show all four flags as badges when true. Each feature also shows its ways, its edges with system reasons, and its person and system closures. The permission catalogue and PLUGS follow as tables. Pointing at, focusing or selecting a way, feature or operation highlights what it reaches and draws its edges; Esc clears. Every name is real, focusable text, so the page reads without script and on a phone.

`diffMaps(before, after): MapDiff` is pure and ignores input order. For modules, operations, features, ways, plugs and permissions it lists `added` and `removed` names and `changed: { name, fields: { field, before, after, added?, removed? }[] }[]`. List fields also name the items that left and joined. Operation changes include all four flags, even when feature flags stay the same. Modules match by service, and a changed role is reported as `role: capability → process` or the reverse. `empty` is true when nothing differs, and `before`/`after` keep the sorted snapshots. `renderMapDiff(diff, "text" | "html")` starts with a summary in plain words, such as `new features: …` and `changed exposure: make_booking (now on mcp)`. The HTML page then draws the after map with removed items kept in place: green is added, red is removed and amber is changed, each with a text label.

`planCommand(args, read)` is the CLI core: pure apart from the `read(path)` callback, it returns `{ exitCode, stdout, stderr, output? }` and the caller writes `output.content` to `output.path`. `runPlanCommand` runs it as a Promise. In this repo, `pnpm plan` runs it from source:

```text
pnpm plan view <plan.json> [-o out.html] [--text]
pnpm plan validate <plan.json>
pnpm plan diff <before.json> <after.json> [-o out.html] [--text]
```

`view` decodes with `Plan`, runs `validatePlan` and renders HTML. `view --text` prints `renderMap(snapshot, "text")` instead: ways with Mean and public features, each feature's person and system closures, modules, plugs and permissions, so one plan reads without a browser. With `-o` it writes that text to the file. `validate` runs those same checks, prints `valid` and exits 0, with no output file. Invalid input prints issues with paths and exits 1; wrong arguments exit 2. `validate` rejects `-o` and `--text`.

A diff side is a plan.json, validated the same way, or app map JSON from `renderMap(snapshot, "json")`. Only `diff` accepts snapshots, detected explicitly by the presence of both `layers` and `permissions`. A detected snapshot must pass map decoding; it never falls back to plan decoding. Older snapshots without operation `transactional` or `needsApproval` fail with paths and a request to regenerate them using the app's map script. Missing facts never default to false. The package ships no bin yet, so a consumer calls `runPlanCommand(process.argv.slice(2), read)` from a short script of its own.

## Validate a plan

A plan is the app's design as data, before any code exists. `Plan` is an Effect Schema, so decode JSON with it first:

```ts
const plan = yield* Schema.decodeUnknownEffect(Plan)(JSON.parse(text));
const snapshot = yield* validatePlan(plan); // Effect<AppMapSnapshot, PlanInvalid>
console.log(renderMap(snapshot, "text"));
```

`Plan` rejects unknown keys at every depth and reports their paths. A copied snapshot's `flags`, `closures`, `layers` or `permissions` cannot silently disappear. Write each flag directly on a plan operation or feature, not inside `flags`; closures are derived. Snapshot JSON is accepted only as a `diff` side. Entry kind is emitted by maps, displayed by every rendering and compared by diffs. Missing entry kinds in old plans/maps mean feature, including read-only features. Legacy mount kind read-model still means projection infrastructure; new mounts use projection.

The plan holds modules `{ name, service, kind, role?, package?, path?, operations }`, where `role` is `"capability" | "process"` and defaults to capability, operations and entry points with explicit `kind: "feature" | "read-model"`, permission, the four optional flags and edges, and ways `{ name, protocol, path | slot | clock | on, mean?, source?, features, public? }`, plus optional `plugs` with the snapshot's plug shape. A feature adds `start?: "person" | { reason, startedBy }`. An edge is an operation name or `{ target, reason }` targeting an operation for a system edge. Features never call features. Flags, edges and start default as the builders do. `path` and `source` are pass-through facts.

`validatePlan` builds real descriptors with stub schemas and handlers, runs the runtime and way checks, and maps the result through the same code as `appMap`. Closures and lifted flags are derived, never authored. A capability module may not call a process module: any such operation edge, plain or system, fails at `modules[m].operations[o].edges[e]`. Process-to-capability and process-to-process edges are allowed; cycle checks still apply. A valid plan renders the same map as the built app.

`PlanInvalid` has kind invalid, a `reason` summary and `issues: { path, reason }[]`. A path such as `features[2].edges[0]` points into the plan. The first pass reports every cheap issue at once, duplicates included: duplicate callable, service and way names, unresolved edges and way features, edges targeting features at the exact `features[f].edges[e]` or `modules[m].operations[o].edges[e]` path, blank system reasons, public feature errors and the plug checks appMap applies. Plan ways derive Mean and hook plugs the same way, so a plan may list them or leave them out. After that, a cycle or a runtime or way check failure is one issue; runtime and way failures use path `plan`.

A plan cannot express everything, so a valid plan is not a working app. Stub endpoints sit at distinct paths and add no route constraints. The real build and `pnpm check` still catch:

- bindings, mount layers, schemas and handlers;
- endpoint methods, paths, route collisions, API prefixes, status, session and CSRF placement;
- MCP tool hints and metadata paths, CORS, origins and body limits;
- hook slot providers and cron parsing;
- whether a declared plug is really the one wired;
- layout, browser-safe contracts, SQL ownership and every other lint rule.
