# @house-rules/application: notes for agents

## What it does

Application owns features, operation bindings, execution, sockets, ways, router, clients, trace and registry. Domain owns operations, callers, kinds, graph checks and units of work. Import each name from its owner. Domain never imports application.

## Define and wire

- Put one `defineFeature(name, options)` in `features/<name>/index.ts`. Options are description, optional title, permission, input, output, failure, edges, flags, optional start and handler. The handler receives `(input, { call, caller })` and only calls declared edges. Keep the file browser-safe.
- Import `defineFeature`, `systemStart`, `Feature`, `AnyFeature` and `FeatureFlags` from application/contract. A feature can be exposed directly. Person is the default start. Hooks, schedules and public features declare a system start. `systemStart(reason, startedBy?)` builds a system caller; reason defaults as startedBy too.
- Modules and read models declare operations with domain's `defineOperation`. Bind them with `bindOperation(operation, handler): Binding`. Capture module services once during layer acquisition. Only `CallerContext` may remain as a handler requirement.
- `CallScope<C>` supplies `caller` and `ScopedCall<C>`. Only declared targets are callable. `InnerFailure` includes Forbidden, CallInvalid and domain NoOpenUnit.
- App `features/index.ts` exports a `Features` object. Only features enter ways, endpoints, hooks and schedules.

Acquire module services, unit, trace and record. Capture services and build operation bindings. Acquire `Runtime.make/layer({ bindings, features, ways })`, then hooks that need it. Runtime automatically dispatches feature handlers. Missing operation bindings, invalid graphs, invalid system starts and duplicate exposures fail with typed GraphInvalid. Only defineFeature creates branded features. Runtime rejects structural forgeries and spread copies, then recomputes closures and lifted flags from the graph. Starts and closure lists are immutable.

`composition({ layer, features, ways, may, system, gatePolicy? })` takes the complete layer, one app-level May plug and one system permission list. It checks feature and Who requirements and revalidates actual exposures against runtime bindings. The root receives ways from main.ts, never imports ways. This kit has no tables or migrations.

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

`featureAndRecheck` is the default gate policy. It checks inner own permissions too. `featureOnly` skips that recheck, not closure checks. Keep both. Plain edges preserve the caller. `asSystem` switches downward and retains the original system reason thereafter. Person calls install CurrentActor from the same Actor; system calls remove ambient person authority.

Only the runtime opens a production unit. Modules and app code join through UnitOfWork.required. Memory registers undo before mutation. Transactional features treat unexpected NoOpenUnit as a defect. Plain features retain the typed unavailable failure. Never repeat approval, watch or unit opening on an inner call.

## Plug sockets and open ways

`defineWay({ name, path, features, who, mean, ...protocol })` keeps a feature tuple in features. HTTP adds endpoints and transport options. MCP adds server, resource and tools shaped as `{ feature, title, idempotent, openWorld }`. Exposure and endpoint/tool sets must agree by identity. A way never carries permissions. HTTP may list `public: [Features.signIn]`; each entry must also be exposed in `features` and declare a system start. Composition and Runtime refuse person starts or unexposed entries. MCP refuses `public`. Only listed requests skip Who and ignore tokens; all other requests still resolve Who. Public starts use only composition's system permissions, with the normal watch, approval, unit and trace.

WhoSocket resolves an Actor. `MaySocket<E = never>.permissionsOf(caller: PersonCaller)` returns `Effect<readonly Permission[], E>`. Capture the plug's services when mounting it. The gate calls it once after Who for each person feature start. `May.fixed(permissions)` gives every person the same list. `May.context(may, { features, system, via, gatePolicy? })` supplies an in-process execution context. `May.system(features, { system, via, gatePolicy? })` supplies a safe hook or schedule context with no person permissions. System starts ignore the person plug. May failures are logged and become MayUnavailable, with fixed public 503 text. Mean.no, Mean.elicitation and Mean.allow supply lower Approval layers. RecordSocket supplies lower CallWatch. Authenticator, Approval and CallWatch stay separate slots. There is no export named Record.

`endpoint(feature, at?, options?)` is browser-safe. Default address is POST /<feature.name>. Keep codecs, session token omission, exact origin checks, request ids and failure-code opt-in. Cookie writes always need CSRF, including session issuance. Session issue accepts a Struct or Union of Structs, at least one with token/expiresAt. It sets a cookie only for token-bearing values and omits token from each member's body schema and client type. Tokenless values return 200 without a cookie. `toOpenApi(endpoints, { ...options, public: way.public })` marks listed routes with no auth; this option changes documentation only. CORS is not authorization. MCP admits bearer tokens on every request and requires this resource's audience. Unset auth and metadata fail closed. Elicitation asks the human and fails closed on unsupported, declined or malformed replies.

`toFetchHandler(app)` owns dispatch and metadata. Dispose it before app.dispose(). Preserve lazy build retries, scoped sharing, interruption and final disposal. `call(app, feature, input, incoming, { way, admitted? })` uses Mean.allow. Admitted state belongs to one request, composition and way. Hooks capture services and use runFeature, never another Who invocation or runtime.

## HTTP, clients and errors

Kind statuses are fixed: not_found 404, conflict 409, forbidden 403, unavailable 503, invalid 400. WordingOverrides changes message only. Public messages never expose internal causes, permissions, reasons or driver text. Keep fixed plumbing messages, generic defect 500 and failure-code headers only for opted-in 4xx kinds.

StepTrace is bounded FIFO memory, default 1000 requests. Reads never allocate or refresh buckets. Finishes never revive evicted buckets. CallWatch records once per feature start, refusals included; inner calls add trace steps only. `Runtime.permissions` is the sorted, unique permission catalogue of registered operations, including bound operations no feature calls. It excludes null and feature-only permissions. `renderRegistry({ operations, features, ways })` lists this catalogue and is pure. Role checks use closures at feature start. Object relation checks stay inside module operations in the same unit as their writes. HTTP and MCP use the same app May; MCP narrows access by exposing read features only.

Read README.md for examples and protocol rules. Tests use public doors and it.effect/it.layer from @effect/vitest. Run package-local tsc and vitest; database unit tests use real Postgres through the validated root environment.
