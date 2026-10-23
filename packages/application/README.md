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
const modules = {
  mounts: [{ ...ItemsMount, layer: itemsLayer }],
  layer: Layer.merge(memoryUnitOfWork, StepTrace.layer()),
};
const app = composition({ modules, features: [showTitle], ways: [way],
  may: Effect.succeed(May.fixed(["items:read"])), system: [] });
```

A package main exports a plain `<Module>Mount` value satisfying `MountDefinition<I, S>`: `{ service: Context.Key<I, S>, operations, bind: (service: S) => readonly Binding[] }`. Read models export theirs from index. Only modules.ts chooses a mount's layer. `ModuleMount` adds that layer; `ModulePlan` pairs the mount tuple with shared infrastructure and optional map-only `plugs`. Each layer must provide its mount's service. The kit checks each binder parameter against its service shape.

`planLayer(plan)` builds raw services from the same plan used by composition. It merges the mount layers, provides shared infrastructure and supplies PermissionCatalogue from the mount descriptors before either builds. Its Layer retains the plan's outputs, errors and uncovered inputs. Use it for service-level tests and tooling, not a second app assembly path. It never calls binders or installs way plugs.

Composition supplies the kit-owned PermissionCatalogue before building modules, then acquires mount services and infrastructure in one memoization scope. It calls each binder once, acquires Runtime, resolves the effectful May, installs hook slots and starts scoped schedule clocks. Standalone `Runtime.layer({ mounts, features, ways })` requires the services but does not build mount layers. The root accepts ways from `main.ts`; it never imports the ways folder.

`Runtime.layer` returns typed `GraphInvalid` on duplicate service keys, operation identities or names, missing/extra/duplicate binder descriptors, cycles, invalid system reasons and duplicate or unregistered exposures. Only `defineFeature` creates a branded feature. Runtime refuses structural forgeries, including spread copies, and recomputes permission closures and lifted flags from the declared graph at acquisition. Feature starts and closure lists are immutable. Composition repeats validation for its actual features and ways against the acquired bindings. Dispatch uses descriptor identity, not name equality.

## Run a feature

`runFeature(feature, input)` returns an Effect with `FeatureFailure<F>` and `FeatureRequirements<F>`. A feature keeps its schemas, edges and identity. `Feature<C, Start>` retains literal lifted flags; `AnyFeature` erases them to booleans for lists.

The `flags` object retains the feature's own literal flags. Its top-level booleans lift across the graph. `readOnly` uses AND; `transactional`, `destructive` and `needsApproval` use OR. A literal nontransactional feature needs no unit service. A system start needs no `CurrentActor`. Widened flags conservatively require transaction and approval services.

Execution opens `CallWatch` once and checks exposed feature identity. For a person start it asks the app's May plug once, after Who, then checks person and system closures. It asks approval once and opens one unit if transactional. Inner calls add trace steps and repeat none of those gates. Every inner call rechecks its own permission against the permissions loaded at feature start.

A plain edge preserves the caller. Domain's `asSystem(target, reason)` switches downward to a system caller. Later system edges preserve the first reason and `startedBy`. Person execution supplies `CurrentActor` from the same Actor. System execution removes ambient person authority. Modules take explicit Actor arguments for object access.

Only this runtime opens a production unit. Writes join it through domain's `UnitOfWork.required`. Memory adapters register undo before mutation. Use domain's `memoryUnitOfWork` or application’s `sqlUnitOfWork`. Unexpected `NoOpenUnit` is a defect inside transactional features and a typed unavailable failure otherwise.

## Open ways and plug sockets

`defineWay({ name, path, features, who, mean, ...protocol })` accepts only features in `features`. Ways carry no permissions. Holding permissions never exposes another way's feature.

Plug May once with `composition({ modules: ModulePlan, features, ways, may, system })`. Pass an Effect such as Party.may(); composition resolves it after modules build, with no mutable cell. `MaySocket<E = never>` has `permissionsOf(caller: PersonCaller): Effect<readonly Permission[], E>`. Capture its long-lived services during mounting. `May.fixed(permissions)` gives every person the same list. A failed lookup is logged and becomes `MayUnavailable`, with fixed public 503 text.

The gate checks the caller's roles through the feature's permission closure. A module checks relations on its loaded object in the same unit as a write. HTTP and MCP share the app May plug. MCP stays read-only by exposing only read features, not by using a separate agent permission list.

`WhoSocket<R>` resolves an Actor from `Incoming`. Composition supplies its requirements. `Mean.no`, `Mean.elicitation` and `Mean.allow` supply lower Approval layers. Elicitation asks a human and fails closed on decline, cancel, malformed replies or missing support. `RecordSocket` supplies lower `CallWatch`; concrete audit storage belongs to call-audit. Authenticator, Approval and CallWatch remain separate slots. There is no export named Record.

HTTP ways hold endpoint descriptors. List public features with `defineWay({ protocol: "http", ..., features: [Features.signIn, Features.profile], public: [Features.signIn] })`. Each public feature must also be in `features` and declare `start: systemStart(reason, startedBy?)`. Composition and Runtime reject person-start or unexposed public entries with GraphInvalid. Only listed requests skip Who, ignoring missing, invalid and valid tokens alike. They run as the declared SystemCaller using composition's system permissions. Watch, approval, transactions, trace and transport guards still apply. Other features still resolve Who. MCP refuses `public`.

Admission stays on the way, not on endpoint descriptors. Pass `public: way.public` to `toOpenApi(endpoints, options)` to mark those operations with `security: []`, overriding any global security requirement. This option only describes admission; it cannot grant access. The router has no HTTP documentation route.

MCP ways hold tools shaped as `{ feature, title, idempotent, openWorld }`, a server and a protected resource. The router builds MCP tools from feature schemas and lifted flags. MCP verifies bearer admission on every request, including existing sessions. At feature execution, every network way removes the ambient HTTP request and strips Authorization, Cookie, Proxy-Authorization and Set-Cookie from CallerScope.incoming.headers. Network feature handlers and inner operations cannot recover credential headers from those request services through Effect.context(). Hooks and schedules instead use a fresh allowlist context built from composition-captured execution services, with no caller-provided services or network request context. Transport, Who, CSRF/origin checks and session handling retain the full request. Request ids, MCP sessions and elicitation keep their protocol context. Who must verify signature, issuer, expiry and resource audience. Missing tokens get the metadata challenge. Unset auth returns 503 without a challenge; metadata keeps GET/HEAD/405 behavior. Browser Origins require an exact allowlist.

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

Both variants accept system-start features only. A hook has exactly one feature. Its caller-owned slot runs on a fresh context containing only composition-captured Runtime, StepTrace, UnitOfWork, CallWatch, the way's Approval, CallPermissions from May.system with the composition gate policy, and CallChannel. Hooks and schedule executions add fresh request ids, fresh log annotations and new root spans. Caller-provided services, log annotations and current spans are not inherited. Every hook invocation uses the hook:<name> channel; schedules use schedule:<name>. Neither calls Who or inherits CurrentActor or network request context. Hook results and mapped errors return to the slot caller; caller interruption still interrupts the hook. Internal causes are logged; only the mapped error reaches the slot. Duplicate slot providers fail GraphInvalid.

A schedule's selector output must be an array of item inputs. Composition parses its UTC cron and checks its next date at acquisition; invalid or impossible clocks fail GraphInvalid. Later next-date failures are also typed GraphInvalid, logged before the driver stops. Scoped drivers start after hooks and first wait for the next tick. Each tick runs the selector, then each item sequentially through runFeature, one unit per transactional item. Item failures are logged and processing continues. There is no startup run, catch-up or distributed lease. Item operations must be idempotent. Disposal interrupts the driver before closing infrastructure. System ways have no path, Who, endpoints or tools, and never enter fetch routing.

Mean is explicit. Trusted provisioning and nightly maintenance use Mean.allow; other system ways use Mean.no unless approved. For TestClock tests, supply the test Clock through the module plan's infrastructure. ManagedRuntime does not inherit ambient test services. Registry scripts use a frozen TestClock layer so acquisition cannot run scheduled work. Registry output includes hook slot keys and schedule clocks.

## Endpoints, clients and failures

`endpoint(feature, at?, options?)` defaults to `POST /<feature.name>` and status 200. `defineApi` keeps keyed endpoints for clients. `toHttpClient`, `toPromiseClient` and `toOpenApi` share those descriptors. Clients keep codecs, exact origin guards, manual redirects and request-id reporting. Unknown or undeclared failure headers stay `Unknown`.

Cookie writes require CSRF checks, even before a session cookie exists. Session issue accepts a Struct or Union of Structs with at least one token/expiresAt member. Only token-bearing values set a cookie. Tokenless values return 200 without a cookie. `SessionOption` permits issue for such unions; `BodyOf` omits token separately from every member, as do body schemas, client types and OpenAPI. Session endpoints forbid GET and CSRF opt-out. Session clear runs on every answer. CORS uses exact origins and never sends Allow-Credentials; it is not access control.

Every expected failure has a domain kind. Statuses are fixed: not_found 404, conflict 409, forbidden 403, unavailable 503, invalid 400. `WordingOverrides` changes messages only. Keep tags, causes, permission details and driver text internal. Plumbing failures use fixed public text; defects get generic 500. Only opted-in 4xx kind codes reach the failure-code header. HTTP and MCP encode outputs once.

`call(app, feature, input, incoming, { way, admitted? })` returns a Promise `Outcome` and supplies Mean.allow. `admit` resolves Who before custom input parsing. Its opaque value belongs to one request, composition and way. Never cache it beyond that request. Hooks use Effect-returning `runFeature` with captured runtime services, `May.system(features, { system: app.system, via })` and approval. They never authenticate again or build another runtime. System starts ignore the person May plug. `May.context(may, { features, system, via })` supplies a person-capable in-process context; both helpers keep exposure separate from permissions.

## Trace and app map

`StepTrace.make/layer({ maxRequests? })` defaults to 1000 request buckets. Bounds must be positive safe integers. Eviction is oldest-created first; reads do not allocate or refresh buckets, and finishes do not revive them. Steps retain feature name, target, caller, reason, order and outcome. `CallWatch` writes once per feature start, refusals included. Inner calls never add audit rows.

`Runtime.permissions` is a frozen, sorted list of every unique permission declared by registered operations, including unused bound operations. It excludes null and permissions declared only by features. The kit-owned PermissionCatalogue has `{ permissions: () => Effect<readonly Permission[]> }` and exposes that same array before modules build.

`appMap(app): Effect<AppMapSnapshot, E | CompositionClosed | GraphInvalid>` acquires the validated app and snapshots its mounts, registered features and actual ways as plain serialisable data. `renderMap(snapshot, "text" | "json" | "mermaid" | "html")` is pure and sorts each collection using code-point order. It includes mounted operations, feature flags and closures, declared edges, exposures, public features and permission owners. Known Mean values are named by identity. It neither runs features nor reads files. Mounts can declare `map: { name, kind: "package" | "read-model", package? }`; without metadata, the fallback name is the service key's last segment and the kind defaults to package. Resolve source ownership before publishing that fallback. Tooling can attach source paths with `appMapSources` from `@house-rules/rules/app-map`, which matches literal builder names to registry imports and package/read-model sources and rejects missing or ambiguous facts. The layers header is fixed and labels that limit. Use memory adapters and a frozen clock for reproducible acquisition. Install a fixed ConfigProvider inside the module plan with `Layer.provideMerge`, so infrastructure and mounted layers use it. Wrapping the caller alone does not configure the composition's separate ManagedRuntime. Text output marks final children with `└─` and wraps lists at 100 columns with aligned continuation lines, keeping identifiers intact. The app map script writes `MAP.md`; its freshness test compares without writing.

### Plugs

`snapshot.plugs` lists `{ name, package?, fills, ways? }`, sorted by name, and text renders it as PLUGS. `fills` is `Who`, `May`, `Mean`, `Record`, `Authenticator`, `ActorResolver`, `Approval`, `CallWatch` or the slot key of a hook way. appMap derives two kinds: `Mean.allow`, `Mean.no` and `Mean.elicitation` by identity with their ways, and `hook:<way>` for each hook way's slot. A Who value, the May Effect and a record layer carry no name, so the app declares them on its ModulePlan:

```ts
plugs: [
  { name: "Identity.who", package: "@house-rules/identity", fills: "Who", ways: ["mcp", "web"] },
  { name: "Party.may", package: "@house-rules/party", fills: "May" },
  { name: "CallAudit.record", package: "@house-rules/call-audit", fills: "Record" },
],
```

Declared plugs are review facts. No runtime code reads them and the runtime does not prove them; review and the pull-out test catch a wrong name. appMap fails with GraphInvalid when a declared plug has a blank or duplicate name, fills an unknown socket or slot, names an unknown or repeated way, puts Who on a hook or schedule way, omits ways for Who, Mean or a hook slot, names ways for May or Record, differs from a derived plug of the same name, uses the reserved `hook:` prefix without matching a hook way, or fills a socket or slot twice on one way or app. Every one of these issues is reported together. A declared plug identical to a derived one merges into it.

Socket fills and hook slot fills are separate, so a hook whose Context key is `Mean` never collides with the Mean socket. In a valid map only a `hook:<way>` plug fills a slot; every other plug fills the socket named by `fills`. A declared plug that is not a derived twin fills the socket when `fills` names one.

The contract door exports browser-safe feature builders and types, endpoint/API definitions, clients, session types and schema-only errors. Main adds runtime, bindings, sockets, ways, composition, trace, app map and lower slots. Neither kit owns tables or needs a migration registration. [AGENTS.md](AGENTS.md) lists the mounting rules.

Run package-local `pnpm exec tsc --project tsconfig.json --noEmit` and `pnpm exec varlock run --path ../../ -- vitest run`. Tests use `@effect/vitest`. Unit suites cover memory and real Postgres.

## See a map or a change as a page

`renderMap(snapshot, "html")` returns one self-contained HTML document: inline CSS and script, no network, and the same bytes for the same snapshot. It shows ways in, features and operations grouped by module and read model, left to right. Hook and schedule ways sit under System. Each feature shows its flags as badges, its ways, its edges with system reasons, and its person and system closures. The permission catalogue and PLUGS follow as tables. Pointing at, focusing or selecting a way, feature or operation highlights what it reaches and draws its edges; Esc clears. Every name is real, focusable text, so the page reads without script and on a phone.

`diffMaps(before, after): MapDiff` is pure and ignores input order. For modules, operations, features, ways, plugs and permissions it lists `added` and `removed` names and `changed: { name, fields: { field, before, after, added?, removed? }[] }[]`. List fields also name the items that left and joined. Modules match by service. `empty` is true when nothing differs, and `before`/`after` keep the sorted snapshots. `renderMapDiff(diff, "text" | "html")` starts with a summary in plain words, such as `new features: …` and `changed exposure: make_booking (now on mcp)`. The HTML page then draws the after map with removed items kept in place: green is added, red is removed and amber is changed, each with a text label.

`planCommand(args, read)` is the CLI core: pure apart from the `read(path)` callback, it returns `{ exitCode, stdout, stderr, output? }` and the caller writes `output.content` to `output.path`. `runPlanCommand` runs it as a Promise. In this repo, `pnpm plan` runs it from source:

```text
pnpm plan view <plan.json> [-o out.html]
pnpm plan diff <before.json> <after.json> [-o out.html] [--text]
```

`view` decodes with `Plan`, runs `validatePlan` and renders HTML. A diff side is a plan.json, validated the same way, or app map JSON from `renderMap(snapshot, "json")`. Invalid input prints each issue path and exits 1; wrong arguments exit 2. The package ships no bin yet, so a consumer calls `runPlanCommand(process.argv.slice(2), read)` from a short script of its own.

## Validate a plan

A plan is the app's design as data, before any code exists. `Plan` is an Effect Schema, so decode JSON with it first:

```ts
const plan = yield* Schema.decodeUnknownEffect(Plan)(JSON.parse(text));
const snapshot = yield* validatePlan(plan); // Effect<AppMapSnapshot, PlanInvalid>
console.log(renderMap(snapshot, "text"));
```

The plan holds modules `{ name, service, kind, package?, path?, operations }`, operations and features with permission, the four optional flags and edges, and ways `{ name, protocol, path | slot | clock, mean?, source?, features, public? }`, plus optional `plugs` with the snapshot's plug shape. A feature adds `start?: "person" | { reason, startedBy }`. An edge is a callable name or `{ target, reason }` for a system edge. Flags, edges and start default as the builders do. `path` and `source` are pass-through facts.

`validatePlan` builds real descriptors with stub schemas and handlers, runs the runtime and way checks, and maps the result through the same code as `appMap`. Closures and lifted flags are derived, never authored. A valid plan renders the same map as the built app.

`PlanInvalid` has kind invalid, a `reason` summary and `issues: { path, reason }[]`. A path such as `features[2].edges[0]` points into the plan. The first pass reports every cheap issue at once, duplicates included: duplicate callable, service and way names, unresolved edges and way features, blank system reasons, public feature errors and the plug checks appMap applies. Plan ways derive Mean and hook plugs the same way, so a plan may list them or leave them out. After that, a cycle or a runtime or way check failure is one issue; runtime and way failures use path `plan`.

A plan cannot express everything, so a valid plan is not a working app. Stub endpoints sit at distinct paths and add no route constraints. The real build and `pnpm check` still catch:

- bindings, mount layers, schemas and handlers;
- endpoint methods, paths, route collisions, API prefixes, status, session and CSRF placement;
- MCP tool hints and metadata paths, CORS, origins and body limits;
- hook slot providers and cron parsing;
- whether a declared plug is really the one wired;
- layout, browser-safe contracts, SQL ownership and every other lint rule.
