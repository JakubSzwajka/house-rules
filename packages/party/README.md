# @house-rules/party

Party owns the people an app knows. A `Person` has an `ActorId`, a trimmed display name of 1..120 characters and a creation time in epoch milliseconds. Any person may read a display name; only its owner may rename it. Party holds no logins or email addresses.

Mount `Party.layerPostgres` with the app's SQL client, or `Party.layerMemory`. Register the package in `migrations.json`. Acquire the service once and pass it to `bindParty(service)` when building the app's `Runtime`.

```text
app feature -> PartyOperations.showPerson / showMe / renamePerson -> Party service
new-login system feature -> PartyOperations.createPerson -> Person.id
account-deletion unit -> party.erase(id)
```

The browser-safe `./contract` door exports `PartyOperations` with `createPerson`, `showPerson`, `showMe` and `renamePerson`, plus schemas, errors and permissions. `defineOperation` declares each operation; `bindParty` uses `bindOperation`. These descriptors have empty edges. Creation is system-only and transactional with `party:create`; rename is person-only and transactional with `party:update`. Reads require a person and `party:read`. No operation asks for approval. App features call these operations through declared edges. Only features are exposed.

Service methods stay `createPerson`, `get`, `me`, `rename` and `erase`. User methods take an explicit Actor. Writes require an open unit; modules never open one. The feature runtime opens the shared unit, so creating a Person and binding a login can commit or roll back together. `erase` is a trusted deletion hook, not an operation.

Expected errors carry their kind at definition. Non-system creation fails with `PersonCallerDenied`; system reads use `PersonNotFound` and system rename uses `PersonUpdateRefused`. Module privacy and self-rename policy still apply beneath the bindings.

Version 0.1.0 is prepared for its first release. Pin domain 0.1.0, application 0.2.0 and Effect 4.0.3 exactly. Published packages load built `dist/`; the workspace loads `src/`. See [AGENTS.md](AGENTS.md) for mounting, storage and verification.
