# Delivery

Outside channels the model calls: `Email.send` and `Push.send`, declared as `Domain.ExternalSystem`s. Delivery owns no data and records no events. A policy or saga calls them, and records what happened on its own aggregate.

## Operations

| Operation | Args | Success | Errors |
| --- | --- | --- | --- |
| `Email.send` | `to`, optional `from`, `subject`, `text`, optional `html`, `idempotencyKey` | `{ providerId }` | `EmailRejected` (the vendor refused the message), `EmailSendFailed` (unavailable, retry) |
| `Push.send` | `subscription` (`endpoint`, `keys`), `payload` (JSON), `ttl` seconds, `idempotencyKey` | nothing | `PushGone` (the endpoint expired, forget it), `PushSendFailed` (unavailable, retry) |

The schemas are the validation. Addresses and subjects are single lines, so a CR/LF header injection never reaches a vendor; push endpoints are HTTPS; text and keys are not blank. A call its schema rejects dies with `ExternalSystemSchemaError`: that is a bug in the caller, not a refusal.

Pass the same `idempotencyKey` on every retry. A sent message cannot roll back with a transaction, and policies run at least once.

## Adapters

```ts
memoryEmail("noreply@example.test") // Email + SentEmails: records each message once per idempotency key
memoryPush({ "https://push.example/x": "gone" }) // Push + SentPushes: records accepted sends
consoleEmail // logs that a message was sent, never addresses, subject or body
consolePush // logs the TTL, never endpoint, keys or payload
```

Stories stub both systems (`stub: [Email, Push]`) and answer each call with `Story.succeed` or `Story.fail`.

## Vendor seam

No SMTP, email API or web-push adapter ships here, because each needs a dependency the owner has not chosen. A vendor adapter is `Email.toLayer(...)` or `Push.toLayer(...)` in the app's server package. It maps provider 404/410 to `PushGone`, a permanent refusal to `EmailRejected`, and everything else to the `...SendFailed` error. It forwards `idempotencyKey` where the vendor supports it (plain SMTP and Web Push do not, so a retry can duplicate a message), keeps VAPID or SMTP secrets as `Redacted`, and never logs addresses, endpoints, keys or bodies. The old `@house-rules/push-node` web-push adapter is the reference for the push side.
