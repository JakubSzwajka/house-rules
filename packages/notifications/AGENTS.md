# @house-rules/notifications: notes for agents

## Mounting

Use `NotificationsMount` with `Notifications.layerMemory(options)` or `Notifications.layerPostgres(options)` in composition/modules.ts. Provide one matching unit adapter. Postgres needs `SqlClient` and this package's migrations before acquisition. Register `{ "package": "@house-rules/notifications" }` in the app's module list.

## Options and ports

Options declare `recipientKind`, enabled `channels`, `categories` with unique names, default channels and mandatory flags, and `maxPageSize`. `dailyDigestTime` defaults to `08:00`; `maxDueBatch` defaults to 100 complete delivery groups, not rows. Retry options are `maxAttempts` (default 5), `retryBaseMs` (1000) and `retryCapMs` (3600000). `Notifications.presets.default` supplies these limits and all three channels. Add your recipient kind and categories. There is no host port. Person methods accept an explicit Actor and use `{ kind: recipientKind, id: actor.id }`.

## Fixed rules

Only system callers may use notify, dueDeliveries, markSent and markFailed bindings. Other operation bindings require a person. Writes join the feature's unit and never open one. `erase(recipient)` is a facade cascade hook, not an operation.

The module owns inbox rows, preferences, quiet windows and delivery ledger rows. It never sends, emits events, captures CurrentActor or imports event-log. NotificationCreated and NotificationRead schemas are in the contract; writes return their facts alongside notifications.

The inbox row is the in-app delivery. Never create in-app ledger rows. In-app is immediate and cannot be disabled. Mandatory default channels ignore saved off/digest modes and quiet hours. Quiet windows hold push/email until the next real local minute outside the window. Timing uses Intl and the Effect clock. `setMyTimeZone(actor, zone)` stores a person's zone independently of quiet hours; null restores UTC. Quiet hours contain only start/end. Digests and quiet windows use the same person zone.

Preference, quiet-hours and zone writes query only that person's pending/held rows, then refresh non-mandatory external rows in the same unit. Keep retryAt independent of dueAt: recompute quiet-window holds on retry rows, never scheduling before their backoff. Off cancels queued rows without delivery. Sent, cancelled and failed rows stay terminal; mandatory rows are untouched. Digest groups are keyed by recipient, channel and mode. Selection bounds groups and never splits their due rows.

Send schedule items through a separate app system feature and channel plugs. Settle their delivery ids with markSent only after sending. Use ledger ids as provider idempotency keys. markFailed increments attempts and stores the private error. Below maxAttempts it returns the row to pending at now + min(retryBaseMs * 2^attempts, retryCapMs). At maxAttempts it becomes terminal failed. dueDeliveries reselects pending retries after backoff. No distributed lease or exactly-once provider guarantee exists.
