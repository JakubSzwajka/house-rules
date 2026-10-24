# @house-rules/email

A provider-neutral email sender port with development console and test memory adapters. It owns no data.

Mount `EmailMount` in composition and provide one adapter to the facade:

```ts
import { consoleEmail, Email } from "@house-rules/email";
import { Layer } from "effect";

const emailLayer = Email.layer.pipe(
  Layer.provide(consoleEmail({ defaultFrom: "noreply@example.test" })),
);
```

The browser-safe `@house-rules/email/contract` exports `EmailOperations.send` (`Email.send`) and `EmailPermissions.send` (`email:send`). A feature calls it with `{ message, idempotencyKey }` and receives `{ providerId? }`. The operation accepts system callers only; people receive `EmailSendForbidden`, even if they hold the permission. It writes no unit or data. Retry with the same key because a sent email cannot roll back with a database transaction.

`EmailSender.send` takes a flat `EmailDelivery`: recipient, optional sender, subject, text body, optional HTML body, optional headers, and a required idempotency key. `EmailRejected` represents invalid input, including explicit blank senders and CR/LF in addresses, subject or headers. `EmailSendFailed` is an unavailable failure with fixed public wording and an optional internal `cause` for provider diagnostics.

Console output contains only a redacted summary. The memory adapter exposes an inspectable test outbox and deduplicates by idempotency key. There is no SMTP or API provider adapter yet. A provider choice and dependency require owner approval. Provider adapters should forward idempotency keys when supported.

See [AGENTS.md](./AGENTS.md) for mounting rules and adapter constraints.
