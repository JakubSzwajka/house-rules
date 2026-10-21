# @house-rules/party: notes for agents

## What it does

Party owns the people an app knows. A `Person` is `{ id, displayName, createdAt }`; its id is the `ActorId`. It holds no email, issuer, subject, organisation or identity binding. Version 0.1.0 peers on exact domain 0.1.0, application 0.2.0 and Effect 4.0.3. Published packages load built `dist/`; this workspace loads source.

## Mount and bind

1. [ ] Mount `Party.layerPostgres.pipe(Layer.provide(database))`, or `Party.layerMemory` in tests. Raw `Party.layer` needs `PersonStore`. Both storage adapters are public.
2. [ ] Register `{ "package": "@house-rules/party" }` in `migrations.json`, or `{ "workspace": "packages/party" }` in this repo.
3. [ ] Share the app's SQL client and unit adapter with other modules. Acquire `Party` once and pass it to `bindParty(service)`. Add those bindings to the app's `Runtime`.
4. [ ] App features declare edges to `PartyOperations`. Only features are exposed. First sign-in calls `PartyOperations.createPerson` through a system edge, then binds the returned id through identity in the same feature unit.
5. [ ] Call `party.erase(id)` in the account-deletion unit. This hook is trusted service code, not an operation.

`@house-rules/party/contract` exports browser-safe schemas, errors, permissions and `PartyOperations`. `defineOperation` declares each operation. `bindParty` uses `bindOperation` and captures the service. Main adds `Party`, storage and policy. The contract door never loads bindings or application values.

| PartyOperations member / name | Permission | Caller | Flags |
| --- | --- | --- | --- |
| `createPerson` / `Party.createPerson` | `party:create` | system only | transactional |
| `showPerson` / `show_person` | `party:read` | person | readOnly |
| `showMe` / `show_me` | `party:read` | person | readOnly |
| `renamePerson` / `rename_person` | `party:update` | person | transactional |

All have empty edges and no approval flag. Non-system creation fails with forbidden `PersonCallerDenied`. System reads fail with `PersonNotFound`; system rename fails with `PersonUpdateRefused`. The binder captures the built service, not per-request identity.

## Service and fixed rules

Methods remain `createPerson({ displayName, id? })`, `get(actor, id)`, `me(actor)`, `rename(actor, id, displayName)`, `erase(id)`. User methods take an explicit Actor and return Effects with no requirements. Creation can adopt an id or generate one; a taken id fails with `PersonAlreadyExists`. Display names trim to 1..120 characters; timestamps use epoch milliseconds.

- Any person can read another person's display name. Only that person may rename it. Refusal happens before reading the row.
- `me` reads only the actor's own Person and fails not-found when none exists.
- Writes join an open unit and fail `NoOpenUnit` outside one. The module and its binders never open units; application lifts the transactional flags.
- No cross-module foreign keys. Storage answers facts, not permission decisions.
- Errors declare kinds at definition: not_found, conflict, invalid, forbidden or unavailable. Ways may override messages only; no app error-view table is needed.
- Module user-facing errors keep their messages; unavailable and plumbing errors use fixed public text, with diagnostic details kept in separate fields or causes.

On consumers whose rules preset needs an explicit contract trust list, add `@house-rules/party` to `trustedContractPackages`. Only `/contract` is trusted. Run package `typecheck`, `test` and `build`; the shared store suite uses memory and real Postgres.
