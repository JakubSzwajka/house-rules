# @house-rules/push

Push stores a person's device subscriptions and exposes a `PushSender` port. `@house-rules/push-node` is the optional Node sender. It returns event facts as ordinary operation results and does not emit events.

Mount `PushMount` with `Push.layerMemory()` in tests or `Push.layerPostgres(options, senderLayer)` with the shared SQL client in an app. The Postgres layer requires an explicit `PushSender` layer, for example `Push.layerPostgres({ defaultTtlSeconds: 3600 }, senderLayer)`. For development only, pass `consolePushSender` explicitly. The memory layer defaults to a test sender. Both accept `defaultTtlSeconds`, a positive integer defaulting to 86400. Register `{ "workspace": "packages/push" }` in `migrations.json`.

`subscribe` and `unsubscribe` act on the explicit person caller. Non-person callers receive `PushSubscriptionNotFound`. Subscribe validates an HTTPS endpoint and nonempty keys. Repeating an active subscription for the same owner returns it unchanged with no events.

An app delivery system feature has an edge to `Push.deliver`. Its operation input is `{ owner, payload, idempotencyKey, ttl? }`. It sends to all active subscriptions through the captured `PushSender`, passes the idempotency key and TTL, soft-expires endpoints answering `"gone"`, and returns `{ sent, expired, events: SubscriptionExpired[] }`. An optional positive integer `ttl` overrides the module default. Person callers receive `PushCallerDenied` (`forbidden`).

Run the delivery feature after the originating transaction commits, in its own unit. The module does not send automatically. `"gone"` means provider 404/410; other send failures fail with `PushSendFailed`, whose public text is fixed and cause is internal. An uncaught failure rolls back every expiry made earlier in that call. Expired endpoints stay expired only if the caller's unit commits. Provider sends cannot roll back, so a ledger retry can resend earlier attempts. Use the same idempotency key on retries.

## Expiry facts on send failure

`PushSendFailed.events` contains the actual `SubscriptionExpired` facts produced by earlier successful expiry mutations in that `deliver` attempt, in delivery order. It excludes the failed send and endpoints whose expiry did not change. A failure before any expiry has `events: []`. Push preserves the sender's `cause` and fixed public message. These facts and the cause are internal data, not public error text or log fields.

A process that catches `PushSendFailed` and commits retry bookkeeping must record `error.events` through its existing `EventLog.record` edge before marking the delivery failed. Use the same fact-recording path as for successful `deliver.events`; do not rebuild facts from endpoints. Recording, expiry and retry bookkeeping must share the calling feature's unit. Let recording failures escape so the unit rolls back. If the send failure escapes instead, or later work fails, discard its facts with the rolled-back unit. Never record them in a new unit after rollback. A retry after a committed expiry does not produce that fact again.

This adds a field without changing the error tag, operation edges, permissions or success shape. Existing `new PushSendFailed({ cause })` sender constructors remain valid and default to an empty array. Decoding older failures without `events` also defaults to `[]`; newly encoded failures include the field. Existing callers that propagate failures keep their rollback behavior. Callers that recover and commit must opt into recording the failure facts.

Expiry marks `expiredAt`; reads exclude expired rows. Subscribing again clears that mark and keeps `createdAt`. `erase(owner)` hard-deletes all of the owner's rows, including expired ones.

`Push.layerMemoryTesting(options?, senderOptions?)` exposes the facade and its `MemoryPushOutbox`. The outbox records every attempt, including subscription, payload, options and result, even when the unit rolls back. Configure `senderOptions.results` per endpoint with `"sent"`, `"gone"` or `"fail"`, or set `senderOptions.result` for all endpoints. Unconfigured endpoints default to `"sent"`. The standalone `memoryPushSender` accepts the same options. The console sender logs delivery metadata, never keys or the payload body.

A web-push adapter implements `PushSender.send(subscription, payload, { ttl, idempotencyKey? })`. Keep that adapter in the consuming app or an approved package. This package adds no provider dependency.

| Operation | Permission | Flags |
| --- | --- | --- |
| subscribe | `push:write` | transactional |
| unsubscribe | `push:write` | transactional, destructive |
| listMine | `push:read` | read-only |
| isSubscribed | `push:read` | read-only |
| subscriptionsFor | `push:deliver` | read-only |
| forgetExpired | `push:deliver` | transactional |
| deliver | `push:deliver` | transactional, system caller only |

`erase(owner)` is the owner-deletion cascade hook, not an operation.
