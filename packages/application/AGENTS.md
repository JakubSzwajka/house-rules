# @house-rules/application: notes for agents

## What it does

Application owns features, operation bindings, execution, sockets, ways, router, clients, trace and registry. Domain owns operations, callers, kinds, graph checks and units of work. Import each name from its owner. Domain never imports application.

## Define and wire

- Put one `defineFeature(name, options)` in `features/<name>/index.ts`. Options are description, optional title, permission, input, output, failure, edges, flags, optional start and handler. The handler receives `(input, { call, caller })` and only calls declared edges. Keep the file browser-safe.
- Import `defineFeature`, `systemStart`, `Feature`, `AnyFeature` and `FeatureFlags` from application/contract. A feature can be exposed directly. Person is the default start. Hooks, schedules and public features declare a system start. `systemStart(reason, startedBy?)` builds a system caller; reason defaults as startedBy too.
- Modules and read models declare operations with domain's `defineOperation`. Bind them with `bindOperation(operation, handler): Binding`. Capture module services once during layer acquisition. Only `CallerContext` may remain as a handler requirement.
- `CallScope<C>` supplies `caller` and `ScopedCall<C>`. Only declared targets are callable. `InnerFailure` includes Forbidden, CallInvalid and domain NoOpenUnit.
- App `features/index.ts` exports a `Features` object. Only features enter ways, endpoints, hooks and schedules.

Export a plain `<Module>Mount` from each package main or read-model index: `{ service, operations, bind }` satisfies MountDefinition. Add its layer only in composition/modules.ts. A ModulePlan holds the mount tuple and an infrastructure layer. `planLayer(plan)` merges mount layers, provides infrastructure and supplies the mount-derived PermissionCatalogue. Composition uses this helper internally; raw-service tests and tooling use it directly, without constructing bindings or plugs. Runtime.layer, composition and planLayer check each binder parameter against its service shape. Composition supplies PermissionCatalogue from descriptors before building modules, acquires services, unit, trace and record, calls each binder once, acquires Runtime and resolves May, then installs hook slots and starts scoped schedule clocks. Standalone `Runtime.layer({ mounts, features, ways })` requires the mount services; it does not build their layers. Duplicate service keys, operation identities/names or missing/extra/duplicate binder descriptors fail with GraphInvalid. Runtime automatically dispatches feature handlers. Missing operation bindings, invalid graphs, invalid system starts and duplicate exposures fail with typed GraphInvalid. Only defineFeature creates branded features. Runtime rejects structural forgeries and spread copies, then recomputes closures and lifted flags from the graph. Starts and closure lists are immutable.

`composition({ modules: ModulePlan, features, ways, may, system })` takes one module plan, an Effect resolving the app-level MaySocket and one system permission list. There is no mutable May cell. Mount layers must provide their own service and all inputs must be covered. It checks feature and Who requirements and revalidates actual exposures against runtime bindings. The root receives ways from main.ts, never imports ways. Group app composition into modules.ts (mounts, adapters and infrastructure), sign-in.ts (providers and Who), access.ts (roles, system permissions and May), app.ts (config and createApp), plus tests/. These names are a review convention, not a lint requirement. This kit has no tables or migrations.

## Execute

`runFeature(feature, input)` returns an Effect with `FeatureFailure<F>` and `FeatureRequirements<F>`. Literal flags stay literal. `readOnly` lifts with AND; destructive, transactional and needsApproval lift with OR. A widened feature conservatively needs unit and approval services. System starts need no CurrentActor.

```text
CallWatch once
  exposed feature identity
  May.permissionsOf(person caller) once, then person and system closures
  Approval once, if lifted
  one UnitOfWork, if lifted
    feature handler -> declared edges -> operation bindings or feature handlers
```

Every inner call rechecks its own permission against the permissions loaded at feature start. Plain edges preserve the caller. `asSystem` switches downward and retains the original system reason thereafter. Person calls install CurrentActor from the same Actor; system calls remove ambient person authority.

Only the runtime opens a production unit. Modules and app code join through UnitOfWork.required. Memory registers undo before mutation. Transactional features treat unexpected NoOpenUnit as a defect. Plain features retain the typed unavailable failure. Never repeat approval, watch or unit opening on an inner call.

## Plug sockets and open ways

`defineWay({ name, path, features, who, mean, ...protocol })` keeps a feature tuple in features. HTTP adds endpoints and transport options. MCP adds server, resource and tools shaped as `{ feature, title, idempotent, openWorld }`. Exposure and endpoint/tool sets must agree by identity. A way never carries permissions. HTTP may list `public: [Features.signIn]`; each entry must also be exposed in `features` and declare a system start. Composition and Runtime refuse person starts or unexposed entries. MCP refuses `public`. Only listed requests skip Who and ignore tokens; all other requests still resolve Who. Public starts use only composition's system permissions, with the normal watch, approval, unit and trace.

WhoSocket resolves an Actor. `MaySocket<E = never>.permissionsOf(caller: PersonCaller)` returns `Effect<readonly Permission[], E>`. Capture the plug's services when mounting it. The gate calls it once after Who for each person feature start. `May.fixed(permissions)` gives every person the same list. `May.context(may, { features, system, via })` supplies an in-process execution context. `May.system(features, { system, via })` supplies a safe hook or schedule context with no person permissions. System starts ignore the person plug. May failures are logged and become MayUnavailable, with fixed public 503 text. Mean.no, Mean.elicitation and Mean.allow supply lower Approval layers. RecordSocket supplies lower CallWatch. Authenticator, Approval and CallWatch stay separate slots. There is no export named Record.

`endpoint(feature, at?, options?)` is browser-safe. Default address is POST /<feature.name>. Keep codecs, session token omission, exact origin checks, request ids and failure-code opt-in. Cookie writes always need CSRF, including session issuance. Session issue accepts a Struct or Union of Structs, at least one with token/expiresAt. It sets a cookie only for token-bearing values and omits token from each member's body schema and client type. Tokenless values return 200 without a cookie. `toOpenApi(endpoints, { ...options, public: way.public })` marks listed routes with no auth; this option changes documentation only. CORS is not authorization. MCP admits bearer tokens on every request and requires this resource's audience. Every network way strips the ambient HTTP request and credential headers (Authorization, Cookie, Proxy-Authorization, Set-Cookie) from CallerScope.incoming.headers at feature execution. Network feature handlers and operations cannot recover credential headers from those request services through Effect.context(). Hooks and schedules use a fresh allowlist context built from composition-captured execution services, with no caller-provided services or network request context. Only transport, Who, CSRF/origin checks and session handling retain the full request. Preserve request ids, MCP sessions and elicitation context. Unset auth and metadata fail closed. Elicitation asks the human and fails closed on unsupported, declined or malformed replies.

`toFetchHandler(app)` owns dispatch and metadata. Dispose it before app.dispose(). Preserve lazy build retries, scoped sharing, interruption and final disposal. `call(app, feature, input, incoming, { way, admitted? })` uses Mean.allow. Admitted state belongs to one request, composition and way. Hooks capture services and use runFeature, never another Who invocation or runtime.

## System ways

`defineWay({ protocol: "hook", name, slot, features: [F], mean, input, failure })` requires a system-start F. The caller-owned slot receives mapped failures, while causes stay in logs. Composition installs it after Runtime. Hooks and schedules run on a fresh context containing only composition-captured Runtime, StepTrace, UnitOfWork, CallWatch, the way's Approval, CallPermissions from May.system, and CallChannel. Each execution adds a fresh request id, fresh log annotations and a new root span. Caller-provided services, annotations, current spans and network request context are not inherited. Hooks use hook:<name>; schedules use schedule:<name>. Neither calls Who or inherits person authority. Hook results and mapped errors return to the slot caller, and caller interruption still interrupts the hook. Duplicate slot providers fail acquisition with GraphInvalid.

`defineWay({ protocol: "schedule", name, clock: { cron, timeZone: "UTC" }, features: [selector, item], mean, input })` requires two system starts and selector output assignable to an array of item inputs. Invalid or impossible cron fails acquisition with GraphInvalid. Every next-date calculation is guarded; later failures log GraphInvalid and stop the driver. A scoped driver starts after hooks, waits for the next tick first, then runs the selector and each item sequentially through runFeature. Each transactional item gets its own unit. Item failures are logged and processing continues. No startup execution, missed-tick catch-up or overlap in one process. Disposal interrupts drivers before pools close. Multiple processes may run a tick; item operations must be idempotent. Registry snapshots show hook slot keys and schedule clocks. Only HTTP/MCP enter fetch routing.

Use explicit Mean.allow only for approved trusted provisioning and scheduled maintenance. Other system ways use Mean.no unless approved. Tests and registry scripts inject a frozen Clock into the module plan; ManagedRuntime does not inherit the test caller's Clock.

## HTTP, clients and errors

Kind statuses are fixed: not_found 404, conflict 409, forbidden 403, unavailable 503, invalid 400. WordingOverrides changes message only. Public messages never expose internal causes, permissions, reasons or driver text. Keep fixed plumbing messages, generic defect 500 and failure-code headers only for opted-in 4xx kinds.

StepTrace is bounded FIFO memory, default 1000 requests. Reads never allocate or refresh buckets. Finishes never revive evicted buckets. CallWatch records once per feature start, refusals included; inner calls add trace steps only. `Runtime.permissions` is the sorted, unique permission catalogue of registered operations, including bound operations no feature calls. It excludes null and permissions declared only by features. `registry(app)` returns an Effect of RegistrySnapshot or the build error/CompositionClosed. It uses the resolved mounts, registered features and real ways, not a second list. `renderRegistry(snapshot)` lists the catalogue and is pure. Role checks use closures at feature start. Object relation checks stay inside module operations in the same unit as their writes. HTTP and MCP use the same app May; MCP narrows access by exposing read features only.

Read README.md for examples and protocol rules. Tests use public doors and it.effect/it.layer from @effect/vitest. Run package-local tsc and vitest; database unit tests use real Postgres through the validated root environment.
