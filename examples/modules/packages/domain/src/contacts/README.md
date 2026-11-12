# Contacts

Contact points for people and organisations, apart from their sign-in credentials: email, phone and postal entries, a primary choice per purpose, and verification by one-time code. One `ContactBook` aggregate per owner holds every rule that spans an owner's contacts, so each one is checked in one transaction.

## Compose

```ts
import * as Contacts from "./contacts/index.ts";

class App extends Domain.Model("App", {
  aggregates: [...Contacts.aggregates],
  policies: [...Contacts.policies],
}) {}

const hosted = App.layer(Contacts.handlers).pipe(
  Layer.provide(Layer.mergeAll(Contacts.memoryVerificationCodes(), Domain.InMemory)),
);
```

Production provides its own `VerificationCodes` adapter, with `VerificationCodes.toLayer`, in place of the memory one.

## Commands

The book id is the owner's party id: a person id, or an organisation id.

| Command | Sent by | Permission | Records |
| --- | --- | --- | --- |
| `AddContact` | owner | `contacts:write` | `ContactAdded`, plus `PrimaryContactChanged` with `primary: true` |
| `RemoveContact` | owner | `contacts:write` | `ContactRemoved` |
| `SetPrimaryContact` | owner | `contacts:write` | `PrimaryContactChanged`, or nothing when no purpose moves |
| `RequestVerification` | owner | `contacts:write` | `VerificationRequested`, or nothing when already verified |
| `VerifyContact` | trusted server code | `contacts:verify` | `ContactVerified`, or nothing when already verified |
| `ImportVerifiedContact` | system, at first sign-in | `contacts:import` | only what changed: `ContactAdded`, `ContactVerified`, `PrimaryContactChanged` |

The owner of a person book is that person. The owner of an organisation book is a person whose `orgId` is the book id and who holds `contacts:manage-org`. Anyone else gets `NotContactOwner` (403). System actors and agents are never owners, not even of their person's book, for writes and reads. Clients read a book through the aggregate's `read` contract with `contacts:read`; a person may read only the books they own, and a system actor may read any.

## Rules

- Emails are trimmed and lowercased; phone numbers lose their whitespace. Postal contacts take `details` and no value, so a book may hold several.
- An id or a normalized value the book already holds for that type is `DuplicateContact`, carrying the id that holds it.
- `primaryFor` is a subset of the contact's purposes. Making B primary for `general` takes only `general` from A, which stays primary for its other purposes. `PrimaryContactChanged.previous` maps each moved purpose to its former holder, or null.
- `primaryOf(book, type, purpose, { verifiedOnly })` answers who to deliver to. Delivery code reads the book with the aggregate client's `state(ref)`.
- `ImportVerifiedContact` is safe to retry: an address the book already holds keeps its id and data and is only verified if it was not.

## Verification

Codes are secrets with randomness and expiry, and events are a permanent record, so neither a code nor its hash enters the model. The `VerificationCodes` external system owns them:

1. The owner sends `RequestVerification`. It records `VerificationRequested` with the address.
2. The `VerificationDelivery` policy calls `VerificationCodes.send`, which issues a one-time code, replaces any earlier code for that contact, and delivers it. A `VerificationNotSent` failure is logged; the owner may ask again.
3. The app's public route takes the code, calls `VerificationCodes.check` and sends `VerifyContact` with the address it returns, as `system("verification", ["contacts:verify"])`. An unknown, used or expired code fails `CodeInvalid`. A contact whose address changed since the code was sent is `ContactNotFound`, so a stale code never verifies a new address.

`memoryVerificationCodes({ ttl, deliver })` keeps codes in memory with the same rules, for stories, tests and local play.

`memoryVerificationCodes` is for stories, tests and local play only. A production adapter must use a cryptographic code, key codes by book and contact, limit attempts, and not issue a fresh code when the policy's event is redelivered.
