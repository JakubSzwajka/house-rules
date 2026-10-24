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
const mount = { ...EventLogMount, layer: EventLog.layerPostgres(options) };
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

replay returns the typed ReplayResult: `enqueued`, `busy` or `already_queued`. Retry `busy` later; it does not confirm a queued replay.

The binder passes Actor explicitly from the caller, or null for a system caller. EventLog never reads CurrentActor. Facts contain kind, subject, payload and nullable scopeId. No secrets belong in events or error summaries.

## App drivers

The app owns consumer system features. An event-sweep schedule uses a transactional selector feature calling claimDue, then an item feature calling takeNext, the consumer feature and settleSuccess in one unit. If that item fails, rollback cannot erase the selector's committed attempt or backoff. Once the retry budget is exhausted, a later selector dead-letters the event and moves on. claimDue returns at most one token per consumer per call. After processing a batch, drivers call it again in a fresh selector unit until it returns no tokens. Keep polling and the sweep for busy consumers, future retries and dead-letter transitions.

EventLog.wakeups() returns an adapter signal stream for an app-owned event-wake hook. Listen at startup and poll as well. Postgres uses transactional LISTEN/NOTIFY; memory uses an in-process signal. A stock hook invokes one feature and does not fan out items. To use one hook for selection and items, its single feature must accept an explicit phase input. App orchestration calls it once per phase and unit, committing selection before each item. Otherwise treat wake as a hint and let the sweep run items.

Default retry policy is five attempts, exponential delays starting at one second, capped at five minutes. Delivery is at least once. Handlers must be idempotent. Cursor locks cover handler units; there is no distributed lease. Outside effects run in consumers after the producer commits, and cannot be undone by database rollback.

See [AGENTS.md](AGENTS.md) for the exact unit protocol, O1-O3 choices, permissions and concurrency limits.
