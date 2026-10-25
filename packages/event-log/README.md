# @house-rules/event-log

Transactional domain-event history with in-process delivery, bounded retries and manual dead-letter replay. The app supplies every event kind and payload Schema. EventLog owns none.

## Mount

```ts
const options = {
  registry: { ...TaskEvents, ...AppEvents },
  consumers: [
    { name: "notifications", kinds: ["task_moved"], maxAttempts: 5 },
  ],
};
const mount = {
  ...EventLogMount,
  layer: EventLog.source.pipe(Layer.provideMerge(EventLog.layerPostgres(options))),
};
```

Composition provides a shared PgClient and sqlUnitOfWork over that client. Register `{ "workspace": "packages/event-log" }` in migrations.json, or `{ "package": "@house-rules/event-log" }` in an installed app. Memory uses `EventLog.layerMemory(options)` and memoryUnitOfWork.

Producer modules declare event facts in their contract and return them alongside operation results. A feature records selected facts through an explicit EventLog.record edge. Recording requires an open unit. Producer changes and events commit or roll back together because the event table is the outbox.

## Operations

| Operation | Permission | Purpose |
| --- | --- | --- |
| record | event-log:record | Validate a fact and stamp its actor, Clock time and request ID |
| read | event-log:read | Read filtered history in global cursor order |
| due | event-log:deliver | Read consumer names whose next event is due |
| claimDue | event-log:deliver | Commit attempts and retry times; return tokens for handler items |
| takeNext | event-log:deliver | Lock the consumer cursor and load the token's event |
| settleSuccess | event-log:deliver | Advance the cursor in the successful handler's unit |
| settleFailure | event-log:deliver | Optionally save a safe failure summary in a separate unit |
| listDeadLetters | event-log:dead-letters | Read dead letters |
| replay | event-log:replay | Manually queue one dead letter; requires approval |

read returns history in ascending numeric event-ID order. IDs remain decimal strings to preserve bigint precision. To continue a filtered query, pass the last returned ID as the exclusive `after` cursor and keep the same filters. The default limit is 100, maximum 1000.

replay returns the typed ReplayResult: `enqueued`, `busy` or `already_queued`. Retry `busy` later; it does not confirm a queued replay.

The binder passes Actor explicitly from the caller, or null for a system caller. EventLog never reads CurrentActor. Facts contain kind, subject, payload and nullable scopeId. No secrets belong in events or error summaries.

## Event ways

The application kit owns the event way and caller-owned EventSource port. `EventLog.source` fills it from this module's consumer registrations, claim/take/settle operations and wake stream. Keep it beside the mount layer with Layer.provideMerge, as above, so both EventLog and EventSource are available. The memory variant uses the same pattern with layerMemory. Optional map metadata is `{ name: "EventLog.source", package: "@house-rules/event-log", fills: "EventSource" }` on the module plan's plugs, with no ways list.

```ts
defineWay({
  protocol: "event", name: "notifications", on: ["task_moved"],
  feature: Features.notifyTaskMoved, mean: Mean.no,
});
```

Each consumer name equals one event way name, and its kinds must match the way's on kinds exactly. Acquisition rejects missing or extra kinds and duplicate consumer ways with GraphInvalid. E9 is one system feature per consumer, now expressed directly as an event way, not two app driver features. The feature uses `EventInput` from application/contract and declares a system start. Input is `{ event: fullStoredEnvelope, causedBy: actorIdOrNull }`. causedBy records who caused the event; it grants nothing. System permissions come from composition, never from the author's roles.

Composition owns delivery: claimDue commits the attempt and retry deadline in its own unit, then takeNext, runFeature and settleSuccess share one new unit per token. Failure rolls that unit back before settleFailure saves a fixed safe summary in another unit. The committed attempt survives. After a batch the driver claims again until none are due. Once attempts are exhausted, a later due claim dead-letters the event and advances the cursor.

The driver listens to adapter wakes, drains source-reported due work at startup, and sweeps periodically. Configure composition.eventSweepMs, default 30000. Postgres uses transactional LISTEN/NOTIFY; memory uses an in-process hint. Failed listeners restart; disposal stops drivers before pools close. Each execution has fresh system permissions, request id, event:<way> channel and root span, with no inherited person or network context. Application never imports event-log. Removing event ways, EventLog.source and its mount leaves apps that do not need events independent of this package.

Default retry policy is five attempts, exponential delays starting at one second, capped at five minutes. A deadline makes a retry eligible; the driver runs it on the next source wake or sweep at or after that time. With the default sweep, a one-second backoff can wait about 30 seconds when no wake arrives. Delivery is at least once. Handlers must be idempotent. Postgres next-event lookups use the `(kind, id)` index even for sparse or missing kinds. Cursor locks cover handler units; there is no distributed lease. Outside effects run in consumers after the producer commits, and cannot be undone by database rollback.

See [AGENTS.md](AGENTS.md) for the exact unit protocol, O1-O3 choices, permissions and concurrency limits.
