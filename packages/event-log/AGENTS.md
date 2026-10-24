# @house-rules/event-log: notes for agents

EventLog is a generic domain-event transport. It owns no kinds. It is not call-audit, which records feature starts and refusals. Read `README.md` for mounting.

## Mount and record

Mount `{ ...EventLogMount, layer: EventLog.layerPostgres(options) }` in composition/modules.ts. Provide the shared PgClient and `sqlUnitOfWork` over that same client. Tests may use `layerMemory(options)` with `memoryUnitOfWork`. Raw `EventLog.layer(options)` needs EventStore. Register `{ "workspace": "packages/event-log" }` in migrations.json, or the installed package entry. The package ships its migrations.

Options are `{ registry, consumers }`. The registry maps kind strings to plain payload Schemas with no service requirements. There are no built-in event kinds or consumers. Consumer names must be unique and their kinds must exist in the registry. Registration is static for the mount lifetime. Keep the same registration order across processes.

Producer modules own fact Schemas in their contract door. Operations return facts alongside their result, such as `{ task, events: [...] }`. A producer never emits, depends on EventLog or reads CurrentActor. A feature chooses which returned facts to record through its declared EventLog.record edge. App-wide facts belong to an app-owned package contract, not a feature-local value export.

A fact is `{ kind, subject: { kind, id }, payload, scopeId }`. Pass null when scope is absent. Record decodes payload against the mounted registry, validates its JSON encoding and stores that encoding. Reads and delivery decode it again. Unknown kinds and malformed payloads fail EventInputInvalid. Preserve old kind Schemas while their history exists; use new versioned kind names when changing a payload incompatibly.

The binder passes the person's Actor explicitly, or null for a system caller, and the available CallRequestId. The module never reads CurrentActor. Clock supplies occurredAt as epoch milliseconds. No secrets belong in facts, envelopes or dead-letter errors. Do not store tokens, credentials, private headers or raw driver errors. Pass a fixed, safe summary to settleFailure and keep causes in internal logs.

Record requires UnitOfWork.required and fails NoOpenUnit outside a live unit. The event table IS the outbox. Producer writes and recording commit together in the feature's unit. The module never opens a unit. Memory registers undo before mutation; Postgres joins the caller's SQL transaction.

## Delivery units and event ways

Consumer config is `{ name, kinds, maxAttempts?, backoff?: { baseMs, capMs } }`, without a handler. Mount the source plug beside EventLog: `EventLog.source.pipe(Layer.provideMerge(EventLog.layerPostgres(options)))`, or layerMemory for tests. It provides the application-owned EventSource service from EventLog's claimDue/takeNext/settle methods, consumer coverage and wake stream. Application never imports event-log. Optional map metadata on the module plan is `{ name: "EventLog.source", package: "@house-rules/event-log", fills: "EventSource" }`, with no ways list.

E9 is one system feature per consumer. Declare `defineWay({ protocol: "event", name, on: kinds, feature, mean: Mean.no })` in the app's ways-in/events/. The way name IS the consumer name. The way's on kinds must match the consumer's kinds exactly. Missing or extra kinds and duplicate consumer ways fail acquisition with GraphInvalid. The feature must declare a system start with reason and startedBy. Composition's explicit system permissions must cover its closure.

Use EventInput from application/contract: `{ event: fullStoredEnvelope, causedBy: actorIdOrNull }`. causedBy is an identifier, never an Actor or authority. The event author does not supply the handler's permissions; even revoking that person's roles cannot change the system's explicit authority. System-only reads require their own explicit operations. Event trace steps retain causedBy as data.

```text
application's scoped event driver
  claimDue(consumer) in its own unit
  COMMIT attempt count + retry time
  per token, one unit:
    takeNext(token): lock consumer cursor
    runFeature(system feature, { event, causedBy })
    settleSuccess(token)
  COMMIT success or ROLLBACK failure
  after rollback: settleFailure(token, fixed safe summary) in a separate unit
```

The module still never opens a unit. Composition's kit driver owns these units. Transactional feature execution joins the delivery unit. A failed handler cannot erase the committed claim, and failure bookkeeping cannot accidentally commit handler writes. At or after the retry deadline, the next source wake or sweep lets claimDue start another attempt. After maxAttempts, the next due claim dead-letters and advances instead of returning another token. A crashed claim-to-delivery handoff consumes an attempt too.

claimDue returns at most one token per consumer per call; the driver claims again after each batch until empty. Empty may mean busy, future retry or a dead-letter transition, so periodic sweeps remain necessary. takeNext returns null for stale/busy tokens and the driver skips the reaction. Settlement stays guarded by attempt and replay generation. The source keeps retry/backoff/dead-letter policy, not the kit.

Drivers start after hooks and merge the source wake stream with a periodic sweep. composition.eventSweepMs is a positive integer, default 30000ms. Startup claims only source-reported due work. Listener failures log and restart after a sweep interval. Fresh execution uses May.system, a new request id, event:<way> channel and root span, without inherited person, caller services or network context. Disposal stops drivers before resources close.

## Retry choices and replay

O1: defaults are five attempts and `min(1000 * 2 ** (attempt - 1), 300000)` milliseconds between claims. The sequence begins 1s, 2s, 4s, 8s, 16s. The cap is five minutes; there is no jitter. Config permits 1 to 100 attempts and base/cap values from 1ms to five minutes, with base <= cap. The last attempt also gets its backoff window before dead-lettering.

A dead letter is per `(consumer, eventId)` and contains lastError, attempts and failedAt. Failure for one consumer does not block another. Dead-lettering skips that reaction until manual replay, so a consumer may be out of date. The next selector can continue with the following event. There is no automatic replay.

O2: replay has its own `event-log:replay` permission and needsApproval. It is in-process only by default. The package exposes no HTTP or MCP way; adding one is an app-owner decision. Use an admin feature and explicit human approval. Replay returns ReplayResult: `enqueued` when queued, `busy` when the consumer lock is held elsewhere, or `already_queued` when pending. A busy result may be retried later; it does not mean the event is queued. Replay queues the dead letter without rewinding the normal cursor. Replay items run before normal items, in event-id order, with a fresh retry budget and generation. Success removes the dead letter; exhausted replay updates it. Old attempt and replay-generation tokens cannot advance a newer attempt.

O3: keep consumer delivery policy in module mount config and reaction Feature values in application event ways. EventLog.source fills the kit's caller-owned port. This package creates no runtime or way. Removing event ways and the plug leaves the kit and unrelated app features building and passing.

## Ordering, signals and limits

Delivery is at least once. Handlers must be idempotent and deduplicate by event id or a natural key. A rollback after an outside effect ran can redeliver the event. Outside effects belong in post-commit consumers, never in the original producer feature's unit; no transaction can unsend a message.

One global increasing cursor orders event history. IDs are decimal strings to preserve PostgreSQL bigint precision over JSON. A transactional sequence row serializes appends until producer commit, so a higher ID cannot commit ahead of an earlier, still-hidden event. Per-aggregate ordering is not implemented. Consumer cursors do not move backwards; adding kinds later does not replay events below an existing cursor.

There is no distributed lease. Postgres row locks and memory live-unit ownership serialize one consumer during the handler unit. nextDue is a retry timestamp, not a lease or a promise that a process owns an event between selector and item. A delayed item can become stale if another selector starts its next attempt. Multiple app processes still need idempotent reactions, particularly for effects outside the database. Memory must share one memoryUnitOfWork with its producers and consumers.

Postgres wakeups use LISTEN/NOTIFY on the fixed house_rules_event_log channel. NOTIFY joins the producer transaction and arrives after commit. The LISTEN stream reserves a pool connection until its scope closes, so size the pool for it plus active units. Memory uses a sliding in-process signal; its signal may arrive before commit or for a rolled-back append. Signals carry no event payload and are hints, never durable delivery. The application's event driver restarts failed listeners, claims due work at startup and keeps a periodic sweep as the safety net for missed signals. Dispose listeners before closing the SQL pool.

read(query) returns oldest-first history, default 100, maximum 1000. after is an exclusive event ID; kinds, subject, scopeId, requestId and inclusive time bounds filter history. listDeadLetters uses an exclusive `{ eventId, consumer }` cursor so pagination cannot skip another consumer's dead letter for the same event. It accepts an optional consumer filter and the same default 100 / maximum 1000 limit. The module publishes event_log_history for optional read models. It has no retention policy, projections or external webhook transport. Read permission grants access to all matching events; apps must not expose this global history to a person without their own scope policy.
