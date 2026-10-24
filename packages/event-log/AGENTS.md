# @house-rules/event-log: notes for agents

EventLog is a generic domain-event transport. It owns no kinds. It is not call-audit, which records feature starts and refusals. Read `README.md` for mounting.

## Mount and record

Mount `{ ...EventLogMount, layer: EventLog.layerPostgres(options) }` in composition/modules.ts. Provide the shared PgClient and `sqlUnitOfWork` over that same client. Tests may use `layerMemory(options)` with `memoryUnitOfWork`. Raw `EventLog.layer(options)` needs EventStore. Register `{ "workspace": "packages/event-log" }` in migrations.json, or the installed package entry. The package ships its migrations.

Options are `{ registry, consumers }`. The registry maps kind strings to plain payload Schemas with no service requirements. There are no built-in event kinds or consumers. Consumer names must be unique and their kinds must exist in the registry. Registration is static for the mount lifetime. Keep the same registration order across processes.

Producer modules own fact Schemas in their contract door. Operations return facts alongside their result, such as `{ task, events: [...] }`. A producer never emits, depends on EventLog or reads CurrentActor. A feature chooses which returned facts to record through its declared EventLog.record edge. App-wide facts belong to an app-owned package contract, not a feature-local value export.

A fact is `{ kind, subject: { kind, id }, payload, scopeId }`. Pass null when scope is absent. Record decodes payload against the mounted registry, validates its JSON encoding and stores that encoding. Reads and delivery decode it again. Unknown kinds and malformed payloads fail EventInputInvalid. Preserve old kind Schemas while their history exists; use new versioned kind names when changing a payload incompatibly.

The binder passes the person's Actor explicitly, or null for a system caller, and the available CallRequestId. The module never reads CurrentActor. Clock supplies occurredAt as epoch milliseconds. No secrets belong in facts, envelopes or dead-letter errors. Do not store tokens, credentials, private headers or raw driver errors. Pass a fixed, safe summary to settleFailure and keep causes in internal logs.

Record requires UnitOfWork.required and fails NoOpenUnit outside a live unit. The event table IS the outbox. Producer writes and recording commit together in the feature's unit. The module never opens a unit. Memory registers undo before mutation; Postgres joins the caller's SQL transaction.

## Delivery units and driver ways

Consumer config is `{ name, kinds, maxAttempts?, backoff?: { baseMs, capMs } }`. It contains no handler. The app owns a system feature for each reaction and binds consumer names to those features in its driver feature graph. It declares those feature edges statically, not by dynamic dispatch outside the graph. System permissions include the reactions' entire closures.

Use two app ways, both with Mean.no:

```text
event-sweep schedule
  selector system feature -> EventLog.claimDue
  selector unit COMMIT: attempt count + retry time
  item system feature(token)
    EventLog.takeNext(token): lock consumer cursor
    call app consumer system feature
    EventLog.settleSuccess(token)
  item unit COMMIT or ROLLBACK

event-wake hook
  app caller listens to EventLog.wakeups()
  app caller nudges the hook at startup and by polling
  hook invokes one app system feature per call
```

claimDue returns DeliveryToken items, at most one per consumer per call. Drivers must call it again after processing the returned items, with a fresh selector unit committed before each batch, until it returns no tokens. One wakeup can cover several recorded events; do not stop after its first batch. An empty batch can also mean a busy consumer, a future retry or a dead-letter transition, so keep polling and the sweep. Its optional query selects one consumer and limits returned tokens, default 100, maximum 1000. due is a read-only hint selector; it does not reserve an attempt. takeNext accepts a committed token, returns `{ event, token }` or null for a stale or busy token, and holds the consumer cursor lock until the handler unit ends. A null result must skip the reaction. Call settleSuccess in that SAME unit, after the reaction succeeds. Do not catch handler failures and turn them into success inside that unit.

Attempt-first bookkeeping is deliberate. A failed handler unit rolls back its writes and cursor movement, but cannot erase the attempt and retry time committed by the selector. At the retry deadline claimDue starts another attempt. After maxAttempts, the next due selector writes the dead letter and advances the cursor instead of returning another item. A crashed selector-to-item handoff also consumes an attempt. This chooses bounded retries over retrying forever after process crashes.

settleFailure(token, safeSummary) is optional. An app caller may invoke a separate transactional system feature AFTER the failed handler runFeature has returned, once rollback is complete. It updates only the lastError of the matching attempt. Calling it inside the failed handler unit would roll its update back too. Without this callback, the DLQ uses "Delivery failed. See internal logs." Attempts, backoff and dead-lettering work without any failure callback. Tests prove both paths against memory and real Postgres.

Stock schedule ways already commit the selector before running each item in its own unit, so this protocol needs no schedule failure callback. Stock hook ways invoke only one feature; they do not fan out a selector's tokens. A wake driver in composition may call one hook whose single feature accepts an explicit phase input for selection or one item. Each call runs one phase in its own unit; commit selection before invoking items, then select again until no tokens remain. Otherwise use the wake hook only as a latency hint and let event-sweep run the selector and items. Neither driver may open units itself or call module handlers directly. Proposed kit follow-up for the owner: schedule/hook item failure settle hook, to attach safe failure details automatically after rollback.

## Retry choices and replay

O1: defaults are five attempts and `min(1000 * 2 ** (attempt - 1), 300000)` milliseconds between claims. The sequence begins 1s, 2s, 4s, 8s, 16s. The cap is five minutes; there is no jitter. Config permits 1 to 100 attempts and base/cap values from 1ms to five minutes, with base <= cap. The last attempt also gets its backoff window before dead-lettering.

A dead letter is per `(consumer, eventId)` and contains lastError, attempts and failedAt. Failure for one consumer does not block another. Dead-lettering skips that reaction until manual replay, so a consumer may be out of date. The next selector can continue with the following event. There is no automatic replay.

O2: replay has its own `event-log:replay` permission and needsApproval. It is in-process only by default. The package exposes no HTTP or MCP way; adding one is an app-owner decision. Use an admin feature and explicit human approval. Replay returns ReplayResult: `enqueued` when queued, `busy` when the consumer lock is held elsewhere, or `already_queued` when pending. A busy result may be retried later; it does not mean the event is queued. Replay queues the dead letter without rewinding the normal cursor. Replay items run before normal items, in event-id order, with a fresh retry budget and generation. Success removes the dead letter; exhausted replay updates it. Old attempt and replay-generation tokens cannot advance a newer attempt.

O3: keep consumer delivery policy in module mount config, and reaction Feature values in the app's driver graph. This preserves the module pull-out test and current hook/schedule rules. The two-way protocol and the hook fan-out limit are described above. No consumer-specific way or runtime is created by this package.

## Ordering, signals and limits

Delivery is at least once. Handlers must be idempotent and deduplicate by event id or a natural key. A rollback after an outside effect ran can redeliver the event. Outside effects belong in post-commit consumers, never in the original producer feature's unit; no transaction can unsend a message.

One global increasing cursor orders event history. IDs are decimal strings to preserve PostgreSQL bigint precision over JSON. A transactional sequence row serializes appends until producer commit, so a higher ID cannot commit ahead of an earlier, still-hidden event. Per-aggregate ordering is not implemented. Consumer cursors do not move backwards; adding kinds later does not replay events below an existing cursor.

There is no distributed lease. Postgres row locks and memory live-unit ownership serialize one consumer during the handler unit. nextDue is a retry timestamp, not a lease or a promise that a process owns an event between selector and item. A delayed item can become stale if another selector starts its next attempt. Multiple app processes still need idempotent reactions, particularly for effects outside the database. Memory must share one memoryUnitOfWork with its producers and consumers.

Postgres wakeups use LISTEN/NOTIFY on the fixed house_rules_event_log channel. NOTIFY joins the producer transaction and arrives after commit. The LISTEN stream reserves a pool connection until its scope closes, so size the pool for it plus active units. Memory uses a sliding in-process signal; its signal may arrive before commit or for a rolled-back append. Signals carry no event payload and are hints, never durable delivery. The app restarts failed listeners, nudges at startup, polls, and keeps event-sweep as the safety net for missed signals. Dispose listeners before closing the SQL pool.

read(query) returns oldest-first history, default 100, maximum 1000. after is an exclusive event ID; kinds, subject, scopeId, requestId and inclusive time bounds filter history. listDeadLetters uses an exclusive `{ eventId, consumer }` cursor so pagination cannot skip another consumer's dead letter for the same event. It accepts an optional consumer filter and the same default 100 / maximum 1000 limit. The module publishes event_log_history for optional read models. It has no retention policy, projections or external webhook transport. Read permission grants access to all matching events; apps must not expose this global history to a person without their own scope policy.
