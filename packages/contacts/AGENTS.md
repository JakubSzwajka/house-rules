# @house-rules/contacts: notes for agents

Contacts owns party contact points, primary choices and email verification. It does not own sign-in credentials or send mail.

## Mounting

Mount `ContactsMount` with `Contacts.layerMemory(options)` or `Contacts.layerPostgres(options)` in composition/modules.ts. Provide the host-owned `ContactOwners` implementation and one unit adapter. Register `{ "package": "@house-rules/contacts" }` in the app's migrations.json. Workspace development uses `{ "workspace": "packages/contacts" }` instead.

`ContactOwners.access(actor, owner)` returns `write`, `read` or `none`. The host resolves self and organisation-admin access through Party. Return `none` for a missing owner. Contacts hides denial behind `ContactNotFound`. Only `write` may mutate. `read` may list and read primary contacts.

## Options and operations

`ContactsOptions` requires `allowedTypes`, a nonempty `purposes` vocabulary, `verificationTokenTtlMs` and `maxPageSize`. Start with `Contacts.presets.default` and override app values. Tokens expire at the deadline, not after it. Phone verification is deferred.

`ContactsOperations` is the browser-safe descriptor catalogue. `bindContacts` captures the facade once. Person operations take an explicit Actor; they never read CurrentActor. Mutations join the feature unit. `removeContact` is destructive. `erase(owner)` is a trusted cascade hook, not an operation, and also requires a unit.

`importVerified({ owner, type: "email", value, purposes, verifiedAt, primary? })` accepts only system callers through its binding, with `contacts:import` and a transactional unit. Use it to copy an identity-verified login email at first sign-in. A retry finds the same normalized email for that owner, verifies it only if unverified and preserves its existing data and verification time. It returns only changed facts, so an unchanged retry has no events.

`issueVerificationToken` accepts only system callers through its binding. Mount it behind a system-start feature or an explicit system edge with `contacts:verify`. `verify` accepts either caller kind with that permission, so an app may expose it through a system-start public feature. This package adds no public route. `primaryFor` accepts system callers for channel delivery; person callers still pass owner access checks. Other operations reject system callers.

## Fixed rules

Operations return plain event facts beside results. The app records those facts through its own event-log edge. This module never emits or imports event-log. `VerificationRequested` contains only contactId. Issuance returns the plaintext token once, with an empty events array; only its SHA-256 hash and expiry persist. Issuing again invalidates the previous token. Verification consumes the token atomically and returns ContactVerified without a token.

Email values are trimmed and lowercased. Phone values are trimmed with whitespace removed. Postal details and extra JSON fields are decoded by ContactDetails. A contact's `primaryPurposes` is a subset of its `purposes`. `setPrimary(contactId, purposes?)` selects only those purposes, defaulting to all the contact's purposes. Displaced contacts keep every unselected primary purpose. `PrimaryChanged.previousContactIds` maps each changed purpose to its previous contact id, or null if unclaimed. Disjoint purposes and other owner/type pairs stay unchanged.

The package owns contact_points and contact_primary_claims. It publishes contacts_view with one row per contact, excluding token hashes and expiries, and contact_primaries_view with one row per claim: owner_kind, owner_id, type, purpose, contact_id. Read models join these views when they need primaries. There are no cross-module foreign keys. Memory and Postgres run the same store and facade suites.
