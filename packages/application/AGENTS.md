# @house-rules/application: notes for agents

Domain modules are packages, never app folders. App areas are features, read-models, ways-in and composition. App node files live in features/<name>/; node.ts, entry.ts, handler.ts and defineNode keep their names.

## What it does

Application binds domain nodes, derives entries and runs their graphs. It owns the caller service, entry gates, sockets, ways, router, clients, trace and registry. Version 0.2.0 peers on exact domain 0.1.0 and `effect` 4.0.3. Domain never imports application. Read `README.md` for wiring and protocol details.

## Define, bind and enter

Import `defineNode`, `asSystem`, caller data, schemas, kinds and unit APIs from domain. This kit does not re-export them.

| API | Contract |
| --- | --- |
| `bindNode(node, (input, scope) => effect): Binding` | Checks decoded input, output and declared failures before erasure. Capture long-lived services in a binder during layer acquisition. Only `CallerContext` may remain in the handler requirements. |
| `NodeScope<N>`, `ScopedCall<N>`, `InnerFailure` | Scope is `{ caller, call }`. `call(target, input)` accepts only declared edge targets. Inner failures are `Forbidden`, `NodeCallInvalid`, domain `NoOpenUnit`. |
| `CallerContext` | Per-request service holding domain's `Caller`. Person calls also provide `CurrentActor` from the same Actor. System calls remove ambient person authority. |
| `defineEntry(node)` | Person start. `defineEntry(node, { start: { kind: "system", reason, startedBy } })` is a hook/schedule start. The source rule permits app nodes only. |
| `Entry<N, Start>`, `EntryFlags<N>` | Descriptor plus start, computed closures and lifted flags. `readOnly` is AND; the other flags are OR over reachable nodes. Literal types stay literal. A widened node conservatively requires transaction and approval. |
| `AnyEntry` | Erased list/registry container with boolean flags. Do not use this container to decide concrete entry requirements. Keep `E extends AnyEntry` in flag-dependent code. |
| `NodeRuntime.make/layer({ bindings, entries, ways })` | Typed `GraphInvalid` acquisition on cycles, unbound reachable nodes, duplicate bindings, invalid system starts or duplicate/unregistered exposures. Composition rechecks its actual graph against those bindings. |
| `runEntry(entry, input)` | Returns an Effect with `EntryFailure<E>` and `EntryRequirements<E>`. Read-only literal entries need no unit slot; system starts need no `CurrentActor`. No wrapper or invented entry permission. |

Execution is fixed, once per entry:

```text
CallWatch.around(entry, input, work, facts)
  exposed-entry identity
  person closure, then system closure
  Approval, if lifted
  UnitOfWork.atomic, if lifted
    root binding -> declared calls -> trace -> optional permission recheck -> child bindings
```

`entryAndRecheck` (`"entry-and-recheck"`) is the default gate policy. It checks each called node's own permission too. `entryOnly` (`"entry-only"`) skips that recheck. Keep both. `Forbidden` carries `{ entry, permission, caller, kind }`, naming the real missing permission. `ApprovalDenied` carries `{ entry, reason, kind }`. Atomic entries turn unexpected `NoOpenUnit` into a defect; nontransactional entries retain it as a typed unavailable failure. Inner nodes never repeat watch, approval or unit opening.

## Plug sockets and open ways

Socket names are `WhoSocket<R>`, `MaySocket`, `MeanSocket`, `RecordSocket<E, R>`. There is no export named `Record`.

- `WhoSocket.resolve(incoming)` returns `Effect<Actor, Refused, R>`. Concrete authentication and identity plugs live in their own packages. Composition must supply R. `Incoming` is `{ headers, url }`.
- `May.fixed(entries, personPermissions)` and `May.system(entries)` hold explicit entry identities. `May.context(may, { system, via, gatePolicy? })` supplies `CallPermissions` for hooks, schedules and focused tests. System permissions have one composition owner.
- `Mean.no`, `Mean.elicitation`, `Mean.allow` bundle lower Approval layers. HTTP normally uses no; MCP uses elicitation; in-process `call` uses allow.
- `RecordSocket.layer` supplies the lower `CallWatch`. The concrete call-audit plug is `CallAudit.record.memory/postgres` in call-audit, never here. A watch must preserve the wrapped exit.

`defineWay({ name, path, entries, who, may, mean, overrides?, ...protocol })` keeps the entry tuple and Who requirements. HTTP adds `{ protocol: "http", endpoints, origins?, cors?, session?, maxBodyBytes? }`. MCP adds `{ protocol: "mcp", allowedOrigins?, server: { name, version }, tools: [{ entry, title, idempotent, openWorld }], resource }`. Entries, May's exposure set and endpoints/tools must agree by identity. Duplicate names, paths, routes or exposures fail typed acquisition.

`composition({ layer, entries, ways, system, gatePolicy? })` takes the complete layer, including `NodeRuntime` and `StepTrace`, plus a unit adapter for transactional entries. It checks all entry/Who requirements. Acquire module services and bindings, then runtime, then hooks which capture that runtime. Do not build a second runtime for a hook. The root takes way values/factories as arguments; it does not import the app's ways folder.

`toFetchHandler(app)` owns HTTP/MCP dispatch and all `resource.paths`. It returns a callable with `dispose()`. Dispose the router before `app.dispose()`. Post-dispose 503 responses still carry a request id and `cache-control: no-store`. The app builds lazily, retries failed builds, shares successful builds and interrupts inflight work before releasing resources. App disposal is final.

`call(app, entry, decodedInput, incoming, { way, admitted? })` returns a Promise `Outcome`. `admit(app, incoming, { way, channel? })` resolves Who first and returns an opaque `Admitted`. Reuse it only within one request on that composition and named way. It keeps Actor, request id and channel; it has no expiry. There is no caller or approval override. Inputs remain validated. Hooks/schedules call the Effect-returning `runEntry` with captured runtime services, `May.system` and approval, not another Who invocation.

## HTTP, clients and errors

`endpoint(entry, at?, { status?, codes?, session?, csrf? })` is the only HTTP descriptor. Defaults are `POST /<entry.node.name>`, 200, no codes, session `"none"`, CSRF `"check"`. `csrf: { skip: true, reason }` needs a nonblank reason and cannot set a session. Session issue requires token/expiresAt output, forbids GET, puts the token only in an HttpOnly/Lax cookie and removes it from body/client/OpenAPI. Session clear clears on every answer. A way with session endpoints needs `session: { cookie }`.

`defineApi({ prefix? }, endpointsByKey)` is browser-safe. A way must use the same prefix, never concatenate it twice. `toHttpClient(endpointArray, options?)` provides name-keyed Effect calls; `toPromiseClient(api, options?)` provides keyed Promise calls. Preserve input/query codecs, output decoding, origin guards, manual redirects, token isolation and request-id reporting. Only declared kind codes on 4xx responses get the failure-code header; 5xx and unknown headers stay `Unknown` in clients.

Every expected node error declares its kind in domain. Status/code mapping is fixed: not_found 404, conflict 409, forbidden 403, unavailable 503, invalid 400. `WordingOverrides<Failure>` maps known tags to message strings only. It receives no caller context and cannot change status, code, body or headers. Responses serialize no error tag or arbitrary fields. App/module errors keep their default message. Kit/plumbing errors have fixed public wording: Forbidden says `You may not use <entry>.`, ApprovalDenied says `This action was not approved.`, and unit, SQL, graph, node-call and closed-composition errors say `Try again shortly.` Internal errors keep their full details; message overrides run on top. Defects and failed overrides get the fixed generic 500. `InputInvalid` retains `entry`, `field`, `issue`, `message`, kind invalid internally.

`toOpenApi(endpoints, { title, version, prefix?, security? })` derives kind responses and lifted read-only/destructive extensions. Configured security applies to every endpoint because every way runs Who, including permission-null roots. Wording overrides belong only to ways. Only admission/framing protocol failures keep their own status, code and challenge. A node cannot use `Refused` to replace its kind's status or code. Keep CORS exact, never credentialed; CSRF still guards every cookie write, including session endpoints with no cookie yet. MCP requires bearer admission on every request and Who must validate the resource audience. Optional `allowedOrigins` admits only those exact browser Origins; without it, requests with an Origin are refused. HTTP encodes outputs once; MCP leaves output encoding to the toolkit. Unset auth and its metadata fail closed; metadata preserves GET/HEAD/405 behavior.

## Trace, registry and doors

`StepTrace.make/layer({ maxRequests? })` retains 1000 request buckets by default. Bounds are positive safe integers. Both constructors throw `RangeError` synchronously at wiring time for invalid bounds; valid layers allocate state lazily per build. Eviction is oldest-created first. `read` never creates or refreshes a bucket; `finish` never revives one. `begin`, `finish`, `refuse`, `read` use request id or the shared null fallback. Every step names its entry, target, caller, reason, order and outcome; snapshots are copied.

`renderRegistry({ nodes, entries, ways })` is pure Markdown rendering of reverse callers, system reasons, start modes, closures and exposures. It neither starts the app nor validates by throwing.

`./contract` exports browser-safe defineEntry and Entry/Endpoint/Api definitions. An app's optional features/<name>/entry.ts exports one direct const defineEntry of its own node; value and type imports are only its own node.ts and application/contract. Ways, endpoints, composition, hooks and schedules share that finished Entry. The contract door also exports session/body types, clients and schema-only kit errors. Main adds runtime, bindings, sockets, ways, trace/registry, lower auth/approval/watch/request-id APIs and `sqlUnitOfWork`. This kit owns no tables and needs no `migrations.json` line. Keep bindings, concrete plugs and composition out of browser descriptor trees. Tests use `@effect/vitest`; package tests import the public door.
