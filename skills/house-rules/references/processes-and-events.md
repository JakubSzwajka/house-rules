# Processes and events

Read this before planning or building features, modules or event reactions. Root AGENTS.md is the law. Use the live Application, EventLog and producing module guides for final APIs.

## Choose the owner

| Work | Put it here |
| --- | --- |
| An exposed person or system action | A feature on an HTTP, MCP, hook, schedule or event way. No unexposed or internal features. Features never call features. |
| State, a computation or an outside effect with its own rules | A capability module. Keep its invariants here. Computation takes inputs as data, not by fetching them from other modules. |
| A shared sequence of operations, or a flow with its own state | A process module, whether stateless or a durable saga. It sequences capabilities through operation edges, not direct service calls. |
| A short sequence needed by exactly one feature | That feature's operation edges. Move it to a process module when a second feature needs it or the sequence gains state. |
| Fetching inputs for a computation | A feature or process module. Pass the fetched data to the computation capability. |

These are P1-P7. `feature-file` rejects imports of other feature indexes. Runtime/composition acquisition rejects feature targets with typed GraphInvalid; validatePlan names the exact edge path. Modules are packages, including app-owned process modules. Processes may call capabilities and acyclic processes. Capabilities never call processes. A process never takes another module's invariants or data ownership.

P9 keeps execution unchanged. Process operation edges run under the calling feature's permission closures, lifted approval and one unit. Inner calls are traced and recheck their own permission against those loaded at feature start. They do not repeat feature gates. Modules never open units. P10 keeps outside effects per item in a system feature's unit, for example through Delivery.sendDue. Do not send inside the original producer feature's unit; reactions run after that commit and must tolerate redelivery.

## Return facts, then record them

E2 and P8 separate the fact from recording:

```text
capability operation -> result + facts from its own before/after state
  composing feature or process operation -> EventLog.record edge
    caller + clock + request -> stored envelope
```

Declare a module fact's schema in its ./contract. Its operation builds and returns it with the result. The capability never emits, depends on event-log or reads CurrentActor. The composing layer must not reconstruct a module fact. Facts about a whole flow belong in an app-owned package contract and are built from that flow's input and operation results.

The composing feature or process operation chooses which facts to record; not every write must become an event (E4). Record through a declared EventLog.record edge in the same unit as the writes. The binding passes the caller's Actor explicitly, or null for a system caller, plus the request id; the clock supplies time. EventLog itself never reads CurrentActor. Mount the app's kind registry; EventLog owns no kinds. Do not put secrets in facts or envelopes.

E22 permits an app that records every write to exempt personal UI state, such as notification read markers, preferences, quiet hours and time zone. Board chooses that exemption while recording domain facts, including notification created, contacts added or verified, and push subscription, removal or expiry. This is an app choice, not a ban on recording UI state or a mandate to record every domain write. EventLog is not CallAudit; keep the feature-start audit as well.

## Place a reaction by authority

H1-H5: a handler is system-started and author-caused. If a side effect must be checked against the person who acted, run it in that person's feature and unit. If it may run later, the system performs it with its own explicit authority and records the author as the cause.

Use EventInput from application/contract. It carries `{ event: EventEnvelope, causedBy: string | null }`. causedBy copies the stored actorId; it may guide logic such as excluding the author from notifications. It is never an Actor or authority. Trace retains it as data; audit attributes execution to the system. Events produced without a person have null causation. Never query the author's roles for delivery or freeze them into an event. A revoked or disabled author must not silently change system authority.

H6: composition's explicit system permission list is the system's authority. Each grant is an owner decision, visible in the plan review. Show the grants and why each handler needs them before implementation. Do not invent a system field in plan.json; the current Plan schema has none. Keep the owner grant list alongside the plan review and wire it through composition's system input.

H7: system access to person-owned data needs separate system-only operations with their own permissions. WorkItems.getForSystem requires work_items:system-read and refuses person callers even if they hold that permission. Normal WorkItems reads still refuse system callers and hide other people's objects. Read the module guide before choosing an operation. Never widen person reads or turn causedBy into an impersonated Actor.

## Declare an event way

H8 and H10 replace app-written event-wake/event-sweep driver features. One consumer has one system-start handler feature on an event way in ways-in/events/:

```ts
defineWay({
  protocol: "event",
  name: "notifications",
  on: ["task_moved"],
  feature: Features.notifyTaskMoved,
  mean: Mean.no,
});
```

The feature declares `start: systemStart(reason, "event:notifications")`. State reason and startedBy explicitly. Mean is mandatory; use Mean.no unless the owner approves otherwise. Event ways have no path, Who, public or MCP fields. They are the third system way beside hooks and schedules, not network routes.

H11: application owns EventSource and never imports event-log. Mount `EventLog.source.pipe(Layer.provideMerge(EventLog.layerPostgres(options)))` in composition/modules.ts, or layerMemory for tests. This keeps both EventLog and EventSource available. Consumer config is `{ name, kinds, maxAttempts?, backoff? }`, not a handler. Optional map plug metadata is `{ name: "EventLog.source", package: "@house-rules/event-log", fills: "EventSource" }`, with no ways list. Removing event-log, its source plug and event ways must leave unrelated work building and passing.

H13 requires exact kind equality. The way name is its consumer name; on kinds are distinct and nonblank. Neither side may have missing or extra kinds. Acquisition fails with typed GraphInvalid naming the differences, or for duplicate consumers, missing EventSource or person-start handlers. Plan validation cannot prove source coverage; acquire the real app to check it.

H12 uses the kit-owned scoped driver, one per event way after hooks:

```text
claim due -> own unit -> COMMIT attempt and retry deadline
  each token -> own unit:
    take event -> runFeature as system -> settle success
  failure -> ROLLBACK -> separate failure-bookkeeping unit
```

Transactional features join the delivery unit; app code and modules never open one. The committed attempt survives handler rollback. EventLog owns backoff and eventual dead-lettering. Pass only fixed safe failure summaries; keep causes in logs. Source wakes plus a periodic sweep drive delivery. composition.eventSweepMs is a positive integer, default 30000. Startup drains source-reported due work only. Retries run on the next wake or sweep at or after the source's retry deadline, not necessarily at that deadline. Listener failures restart after a sweep interval; disposal stops drivers before resources close. Delivery is at least once: handlers must be idempotent and dedupe by event id or a natural key. Cursor locks serialize a consumer's handler unit, not a distributed lease. A database rollback cannot unsend an outside effect.

H14 uses May.system, a fresh request id, fresh log annotations, event:<way> channel and a new root span. No caller services, person authority, annotations, parent span or network context is inherited. Neither a second runtime nor Who belongs in a reaction.

## Plan and prove the boundaries

P11 and H9 require explicit `role: "capability" | "process"` on every plan module. Set matching map.role and package identity on mounts. The API accepts omitted roles as capability for older inputs; do not rely on that default in a new plan. The validator rejects capability-to-process edges, plain or system. Every map rendering, including MAP.md, shows the process layer, real operation edges and framework (@house-rules/*) versus app-owned modules.

H15 plan ways use `{ name, protocol: "event", on: [kinds], features: [handlerName], mean: "no" }`. This is a one-entry features array in plans, unlike the builder's singular feature. Validation checks the system start. Every map rendering shows kinds and their handler; map diffs include on and module role changes. Keep the built map and plan aligned.

Before calling the app ready:

- Check every feature has a way and no feature calls another feature. Reuse must appear as process operation edges, with no capability-to-process dependency.
- Acquire real event ways to prove exact consumer-kind coverage, system starts, explicit Mean and source wiring. Include missing and extra kind refusal cases.
- Test system-only reads against person callers and preserve A/B privacy tests for person reads. Check revoked-author and null-author reactions still use only the owner-approved system grants.
- Verify causedBy stays data in handler input and trace, while execution and audit use the system. Test fresh-context isolation and rollback/retry idempotence, and prove the source plug's pull-out test.
- Run pnpm check and pnpm test. Keep plan validation, built-map freshness and the owner grant list in the review evidence.
