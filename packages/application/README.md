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

A package main exports a plain `<Module>Mount` value satisfying `MountDefinition<I, S>`: `{ service: Context.Key<I, S>, operations, bind: (service: S) => readonly Binding[] }`. Read models export theirs from index. Only modules.ts chooses a mount's layer. `ModuleMount` adds that layer; `ModulePlan` pairs the mount tuple with shared infrastructure. Each layer must provide its mount's service. The kit checks each binder parameter against its service shape.

`planLayer(plan)` builds raw services from the same plan used by composition. It merges the mount layers, provides shared infrastructure and supplies PermissionCatalogue from the mount descriptors before either builds. Its Layer retains the plan's outputs, errors and uncovered inputs. Use it for service-level tests and tooling, not a second app assembly path. It never calls binders or installs way plugs.

Composition supplies the kit-owned PermissionCatalogue before building modules, then acquires mount services and infrastructure in one memoization scope. It calls each binder once, acquires Runtime, resolves the effectful May, installs hook slots and starts scoped schedule clocks. Standalone `Runtime.layer({ mounts, features, ways })` requires the services but does not build mount layers. The root accepts ways from `main.ts`; it never imports the ways folder.

`Runtime.layer` returns typed `GraphInvalid` on duplicate service keys, operation identities or names, missing/extra/duplicate binder descriptors, cycles, invalid system reasons and duplicate or unregistered exposures. Only `defineFeature` creates a branded feature. Runtime refuses structural forgeries, including spread copies, and recomputes permission closures and lifted flags from the declared graph at acquisition. Feature starts and closure lists are immutable. Composition repeats validation for its actual features and ways against the acquired bindings. Dispatch uses descriptor identity, not name equality.

## Run a feature

`runFeature(feature, input)` returns an Effect with `FeatureFailure<F>` and `FeatureRequirements<F>`. A feature keeps its schemas, edges and identity. `Feature<C, Start>` retains literal lifted flags; `AnyFeature` erases them to booleans for lists.

The `flags` object retains the feature's own literal flags. Its top-level booleans lift across the graph. `readOnly` uses AND; `transactional`, `destructive` and `needsApproval` use OR. A literal nontransactional feature needs no unit service. A system start needs no `CurrentActor`. Widened flags conservatively require transaction and approval services.

Execution opens `CallWatch` once and checks exposed feature identity. For a person start it asks the app's May plug once, after Who, then checks person and system closures. It asks approval once and opens one unit if transactional. Inner calls add trace steps and repeat none of those gates. `featureAndRecheck`, the default policy, also checks each called target's own permission. `featureOnly` skips that recheck. Both keep closure checks.

A plain edge preserves the caller. Domain's `asSystem(target, reason)` switches downward to a system caller. Later system edges preserve the first reason and `startedBy`. Person execution supplies `CurrentActor` from the same Actor. System execution removes ambient person authority. Modules take explicit Actor arguments for object access.

Only this runtime opens a production unit. Writes join it through domain's `UnitOfWork.required`. Memory adapters register undo before mutation. Use domain's `memoryUnitOfWork` or application’s `sqlUnitOfWork`. Unexpected `NoOpenUnit` is a defect inside transactional features and a typed unavailable failure otherwise.

## Open ways and plug sockets

`defineWay({ name, path, features, who, mean, ...protocol })` accepts only features in `features`. Ways carry no permissions. Holding permissions never exposes another way's feature.

Plug May once with `composition({ modules: ModulePlan, features, ways, may, system, gatePolicy? })`. Pass an Effect such as Party.may(); composition resolves it after modules build, with no mutable cell. `MaySocket<E = never>` has `permissionsOf(caller: PersonCaller): Effect<readonly Permission[], E>`. Capture its long-lived services during mounting. `May.fixed(permissions)` gives every person the same list. A failed lookup is logged and becomes `MayUnavailable`, with fixed public 503 text.

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

`call(app, feature, input, incoming, { way, admitted? })` returns a Promise `Outcome` and supplies Mean.allow. `admit` resolves Who before custom input parsing. Its opaque value belongs to one request, composition and way. Never cache it beyond that request. Hooks use Effect-returning `runFeature` with captured runtime services, `May.system(features, { system: app.system, via })` and approval. They never authenticate again or build another runtime. System starts ignore the person May plug. `May.context(may, { features, system, via, gatePolicy? })` supplies a person-capable in-process context; both helpers keep exposure separate from permissions.

## Trace, registry and doors

`StepTrace.make/layer({ maxRequests? })` defaults to 1000 request buckets. Bounds must be positive safe integers. Eviction is oldest-created first; reads do not allocate or refresh buckets, and finishes do not revive them. Steps retain feature name, target, caller, reason, order and outcome. `CallWatch` writes once per feature start, refusals included. Inner calls never add audit rows.

`Runtime.permissions` is a frozen, sorted list of every unique permission declared by registered operations, including unused bound operations. It excludes null and feature-only permissions. The kit-owned PermissionCatalogue has `{ permissions: () => Effect<readonly Permission[]> }` and exposes that same array before modules build. `registry(app): Effect<RegistrySnapshot, E | CompositionClosed>` acquires the validated app and snapshots its mounts, registered features and actual ways. `renderRegistry(snapshot)` is pure Markdown rendering. It lists the permission catalogue, operations, features, reverse callers, system reasons, closures and exposures. Freshness tests compare without writing.

The contract door exports browser-safe feature builders and types, endpoint/API definitions, clients, session types and schema-only errors. Main adds runtime, bindings, sockets, ways, composition, trace, registry and lower slots. Neither kit owns tables or needs a migration registration. [AGENTS.md](AGENTS.md) lists the mounting rules.

Run package-local `pnpm exec tsc --project tsconfig.json --noEmit` and `pnpm exec varlock run --path ../../ -- vitest run`. Tests use `@effect/vitest`. Unit suites cover memory and real Postgres.
