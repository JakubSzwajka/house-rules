# @house-rules/push

Push stores a person's device subscriptions and exposes a `PushSender` port. It returns event facts as ordinary operation results and does not emit events.

Mount `PushMount` with `Push.layerMemory()` in tests or `Push.layerPostgres(options, senderLayer)` with the shared SQL client in an app. The Postgres layer requires an explicit `PushSender` layer, for example `Push.layerPostgres({ defaultTtlSeconds: 3600 }, senderLayer)`. For development only, pass `consolePushSender` explicitly. The memory layer defaults to a test sender. Both accept `defaultTtlSeconds`, a positive integer defaulting to 86400. Register `{ "workspace": "packages/push" }` in `migrations.json`.

`subscribe` and `unsubscribe` act on the explicit person caller. Non-person callers receive `PushSubscriptionNotFound`. Subscribe validates an HTTPS endpoint and nonempty keys. Repeating an active subscription for the same owner returns it unchanged with no events.

An app delivery system feature has an edge to `Push.deliver`. Its operation input is `{ owner, payload, idempotencyKey, ttl? }`. It sends to all active subscriptions through the captured `PushSender`, passes the idempotency key and TTL, soft-expires endpoints answering `"gone"`, and returns `{ sent, expired, events: SubscriptionExpired[] }`. An optional positive integer `ttl` overrides the module default. Person callers receive `PushCallerDenied` (`forbidden`).

Run the delivery feature after the originating transaction commits, in its own unit. The module does not send automatically. `"gone"` means provider 404/410; other send failures fail with `PushSendFailed`, whose public text is fixed and cause is internal. Failure rolls back every expiry made earlier in that call. Expired endpoints stay expired only if the caller's unit commits. Provider sends cannot roll back, so a ledger retry can resend earlier attempts. Use the same idempotency key on retries.

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
