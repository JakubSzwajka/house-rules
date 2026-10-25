# @house-rules/contacts

Contact points for people and organisations, separate from their login credentials. Stores email, phone and postal contacts, chooses primaries by purpose and verifies email with one-time tokens. The app supplies access decisions and sends verification mail.

## Mount

```ts
import { Contacts, ContactsMount } from "@house-rules/contacts";

const contactsLayer = Contacts.layerPostgres({
  ...Contacts.presets.default,
  purposes: ["general", "billing"],
  verificationTokenTtlMs: 30 * 60 * 1000,
  maxPageSize: 50,
});
```

Pair `ContactsMount` with that layer in composition/modules.ts. Provide `ContactOwners`, SqlClient and the SQL unit adapter. Memory uses `Contacts.layerMemory(options)` with the memory unit adapter. The host port answers `access(actor, { kind, id })` with `write`, `read` or `none`; missing owners return `none`. A denied or missing contact returns ContactNotFound, never an access explanation.

Register the package in migrations.json:

```json
{ "modules": [{ "package": "@house-rules/contacts" }] }
```

## Contract

Import `ContactsOperations`, contact schemas and event schemas from `@house-rules/contacts/contract`. Each operation declares its permission and flags.

| Operation | Permission | Behaviour |
| --- | --- | --- |
| addContact | contacts:write | Transactional; returns `{ contact, events }` |
| importVerified | contacts:import | Transactional, system callers only; idempotently imports a verified email and returns `{ contact, events }` |
| removeContact | contacts:write | Transactional, destructive; returns `{ contactId, events }` |
| setPrimary | contacts:write | Transactional; returns `{ contact, events }` |
| listFor | contacts:read | Read-only; accepts owner and optional page; returns `{ contacts, next? }` |
| requestVerification | contacts:write | Transactional; returns `{ contactId, events: [VerificationRequested] }`, no token |
| issueVerificationToken | contacts:verify | Transactional, system callers only; returns `{ contact, token, expiresAt, events: [] }` |
| verify | contacts:verify | Transactional; accepts a token for either caller kind; returns `{ contact, events }` |
| primaryFor | contacts:read | Read-only; accepts owner, type, purpose and verifiedOnly; returns a contact or null |

Except for verified imports, verification, issuance and system delivery reads through primaryFor, bindings require a person. Build a system-start feature for issuance and for unsigned-in verification clicks. Features own public-path decisions and event recording. Contacts adds no network route and never depends on event-log.

`ContactEvents` exports ContactAdded, ContactRemoved, PrimaryChanged, VerificationRequested and ContactVerified. Facts use `kind` and `contactId`; no fact carries a token. A consumer receives VerificationRequested, issues a token in a system feature, then sends it through the app's email path. Never put the returned token into an event, audit payload or log.

## Storage choices

A contact has an owner ref, type, normalized value, JSON details, nonempty purposes, primaryPurposes, verifiedAt and createdAt. Email normalization trims and lowercases. Phone normalization removes whitespace without a phone library. Duplicate normalized values conflict only within the same owner and type. Postal values are null, so several postal contacts are allowed. ContactDetails accepts optional address fields and preserves other JSON fields.

`primaryPurposes` is a subset of the contact's purposes. `setPrimary` accepts `{ contactId, purposes? }`; the facade takes `(actor, contactId, purposes?)`. Omit purposes to select all the contact's purposes. Selecting B for notifications removes only notifications from A, so A can remain primary for billing. `PrimaryChanged.previousContactIds` maps each changed purpose to its former contact id, or null if it had none. If no purpose moves, `setPrimary` returns no events. Postgres serializes selections by owner/type and enforces unique owner/type/purpose claims. Lists use exclusive createdAt/id cursors, capped by maxPageSize.

For first sign-in, call `importVerified` from a system-start feature with `contacts:import`. Input is `{ owner, type: "email", value, purposes, verifiedAt, primary? }`. New contacts return ContactAdded and ContactVerified, plus PrimaryChanged when requested. An existing normalized email for the same owner is verified only if unverified; its other fields and original verification time stay intact. Only changes return events. An unchanged retry returns the same contact and an empty events array. `primary: true` selects all the stored contact's purposes.

Only email verification is supported. Issuance replaces the previous hash and deadline. Verification checks the hash and strict expiry, clears the token and sets verifiedAt in one write. Unknown, expired and already-used tokens all return VerificationInvalid. The plaintext token is not stored. contacts_view publishes one row per contact without token columns or a primary flag. contact_primaries_view publishes owner_kind, owner_id, type, purpose and contact_id per claim; read models join the views for primary choices.

Call the facade's trusted `erase(owner)` cascade hook inside an existing feature unit when deleting an account. It deletes contacts and their primary and token state. It is not an operation. Identity continues to own login identifiers even when the app initially copies one into contacts.

## Checks

```sh
pnpm --filter @house-rules/contacts typecheck
pnpm exec biome check packages/contacts
pnpm --filter @house-rules/contacts test
```

The shared suites exercise memory and a real throwaway Postgres database. See [AGENTS.md](AGENTS.md) for mounting rules.
