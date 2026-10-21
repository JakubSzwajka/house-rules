# @house-rules/identity: notes for agents

## What it does

Identity maps a verified login, its `(issuer, subject)` pair, to an `ActorId`. It owns `identity_binding`. One actor may have many bindings. It never links by email or stores claims. An `Authenticator` verifies tokens; `Identity.who` resolves the Actor for a way. Version 0.1.0 peers on exact domain 0.1.0, application 0.2.0 and Effect 4.0.3. Published packages load built `dist/`; the workspace loads source.

## Mount and bind

1. [ ] Pick an actor resolver. `Identity.layerPostgres` needs the shared SQL client; `layerMemory` is for tests. Both provide `Identity` and `ActorResolver`. Raw `Identity.layer` needs `BindingStore`. For one issuer with no table, `Identity.subject({ issuer })` treats its subject as the ActorId. A foreign issuer is refused before the new-login hook.
2. [ ] With bindings, register `{ "package": "@house-rules/identity" }` in `migrations.json`, or `{ "workspace": "packages/identity" }` in this repo.
3. [ ] Acquire `Identity` once and call `bindIdentity(service)`. Add its binding to the app's `Runtime`. The browser-safe `./contract` door exports binding schemas/errors and `IdentityOperations`; main adds services, ports, adapters and the binder.
4. [ ] Fill `FirstSignIn`. `Identity.refuse` answers 403 `not_invited`. For open signup, capture the app's runtime, trace, watch and unit after runtime acquisition. The hook runs the app's system-start first-sign-in feature with `May.system`, system permissions and approval. That feature calls the shared creation/binding operations as system. Return its ActorId and map hook failures to `Refused`.
5. [ ] Provide an `Authenticator` and the resolver/hook in the final root layer. Fill a way's Who with `Identity.who({ token: "bearer", audience?, challenge? })`. Cookie sources and ordered token sources work too. May owns permissions separately.
6. [ ] Call `identity.unbindAll(actorId)` in the account-deletion unit.

## Who contract

`IdentityWhoOptions` is `{ token: TokenSource, audience?: string, challenge?: (error?: "invalid_token") => string }`. There is no grant callback.

`Identity.who(options)` returns `WhoSocket<Authenticator | ActorResolver | FirstSignIn>`. Its `resolve(incoming)` returns an Actor, not an Effect Context. It reads the token, verifies once, resolves the actor and calls the hook only for an unknown login. Construction captures neither request services nor `FirstSignIn`. The application installs request services and permissions. A hook must not authenticate again or build another runtime.

| Refusal | Status / code |
| --- | --- |
| missing token | 401 `token_missing`, optional bare challenge |
| invalid, expired, wrong issuer/audience | 401 `token_invalid`, optional invalid_token challenge |
| authenticator unavailable | 503 `auth_unavailable`, no challenge |
| binding lookup unavailable | 503 `identity_unavailable`, no challenge |
| invite-only unknown login | 403 `not_invited` |

## Service and fixed rules

Methods stay `resolve`, `bind`, `unbind`, `bindingsOf`, `unbindAll`. They return Effects with no requirements. Writes join an open unit and fail `NoOpenUnit` outside one; the module never opens a unit.

`IdentityOperations.bindLogin`, declared with `defineOperation` and named `Identity.bindLogin`, takes `{ issuer, subject, personId }` and returns that ActorId after binding. Permission is `identity:bind`; flags are transactional true, all others false; edges are empty. A person caller gets forbidden `IdentityCallerDenied`. `bindIdentity` uses `bindOperation`. App features call this operation through declared edges. Only features are exposed.

- Binding the same login to its current actor is a no-op. Binding it to another fails with conflict `BindingTaken`.
- Empty issuer/subject fails with invalid `BindingInvalid` and never resolves. `unbind(actorId, login)` removes only that actor's binding.
- `actor_id` is a plain column, not a cross-module foreign key. Deleting a binding never deletes another module's data.
- Storage failures have unavailable kind; `ForeignIssuer` has forbidden kind but Who preserves its 401 auth translation.
- Module user-facing errors keep their messages; unavailable and plumbing errors use fixed public text, with diagnostic details kept in separate fields or causes.

Run package `typecheck`, `test` and `build`. The store suite covers memory and real Postgres; Who tests cover token security, hook behavior and rollback.
