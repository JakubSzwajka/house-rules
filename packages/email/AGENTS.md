# @house-rules/email: notes for agents

## What it does

Email sends messages through the `EmailSender` port. It owns no data, migrations, tables or event kinds. It does not depend on event-log or look up actors. Callers supply recipient, content and an idempotency key.

## How an app mounts it

Mount `EmailMount` with `Email.layer` in composition/modules.ts. Provide exactly one adapter to the facade layer:

```ts
Email.layer.pipe(
  Layer.provide(consoleEmail({ defaultFrom: "noreply@example.test" })),
)
// Tests may use memoryEmail({ defaultFrom: "noreply@example.test" }) instead.
```

The main door exports `Email`, `bindEmail`, `EmailMount`, `EmailSender` and adapters. The browser-safe `./contract` door exports message/result schemas, errors, `EmailPermissions.send` (`email:send`) and `EmailOperations.send` (`Email.send`). It exports no services, bindings or adapters.

`Email.send` takes `{ message, idempotencyKey }` and returns `{ providerId? }`. Only system callers may send. A person is refused with `EmailSendForbidden` (`forbidden`), even with `email:send`. Email has no not-found concept. The operation is not transactional and opens no unit. A delivery feature must pass the same idempotency key on retries; a surrounding database rollback cannot undo a sent email.

The facade captures `EmailSender` once. Its `send(message, idempotencyKey)` delegates to `EmailSender.send`, which accepts a flat `EmailDelivery`: `to`, optional `from`, `subject`, `text`, optional `html`, `idempotencyKey` and optional headers. A missing `from` uses the required `defaultFrom`. An explicit blank `from`, blank required text or blank default sender fails with `EmailRejected` (`invalid`). CR/LF is rejected in recipients, sender addresses, subject, and header names and values. Message bodies may contain line breaks.

Adapter or provider availability failures use `EmailSendFailed` (`unavailable`) with fixed public text "Email sending is unavailable." Its optional internal `cause` keeps provider diagnostics out of the public message. Never copy those diagnostics into public wording.

The console adapter logs only a summary. It never logs addresses, subject, headers, or message bodies. This also prevents disclosure of mandatory security mail bodies. The memory adapter is for tests and exposes `MemoryEmailOutboxTesting`; it keeps the first message for each `idempotencyKey`.

A future SMTP or API-provider adapter implements `EmailSender` and is chosen by the app owner. No provider or dependency is selected here. The adapter must pass `idempotencyKey` through when the provider supports it. Plain SMTP has no standard idempotency support, so a retry can duplicate a message.

No `migrations.json` entry is needed. The pull-out test removes the email mount, its adapter layer and the app's email delivery edge without changing other modules.

## Fixed rules

- Keep app-specific content and provider dependencies out of this package's domain boundary.
- Never log full email bodies or sensitive message metadata.
- Keep public unavailable messages fixed and provider diagnostics private.
- No database, migrations, event-log dependency or actor lookup belongs here.
