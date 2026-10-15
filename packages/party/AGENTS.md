# @house-rules/party: notes for agents

## What it does

A domain addition: the people an app knows. A `Person` is `{ id, displayName, createdAt }`, and its `id` is the `ActorId`. When Party is mounted, the acting user is a Person. `Party` uses `defineModule` from `@house-rules/domain`, captures `PersonStore`, and takes an explicit Actor on user methods. It ships three browser-safe contracts at `@house-rules/party/contract`, built with `@house-rules/application/contract`. It has no email, no external ids and no identity bindings, and it never imports `@house-rules/identity` or `@house-rules/auth-jwt`. Organisations are out of scope. Version 0.1.0 is ready for its first npm release, not yet published. It peers on exact `@house-rules/domain` 0.1.0, `@house-rules/application` 0.2.0 and Effect 4.0.3, and ships built JavaScript and declarations in `dist/`.

## How an app mounts it

1. [ ] Provide the module beside the app's SQL client:

   ```ts
   const party = Party.layerPostgres.pipe(Layer.provide(database));
   ```

   Tests and apps with no database use `Party.layerMemory`. The raw `Party.layer` needs `PersonStore`. Both adapters are exported.

2. [ ] Add the module to the root `migrations.json`:

   ```json
   { "package": "@house-rules/party" }
   ```

   Use `{ "workspace": "packages/party" }` only for this repo's source workspace.

3. [ ] Give `Party` the same `SqlClient` layer, and the same `sqlUnitOfWork`, as the app's other stores. One unit then covers all their writes.
4. [ ] Fill the app's first-sign-in port with `Party.createPerson({ displayName })` inside `UnitOfWork.atomic`. It takes no Actor, since nobody is signed in yet. Pass `{ id }` to adopt an id you already have; leave it out and Party makes one. A taken id fails with `PersonAlreadyExists`.
5. [ ] Use `implement(showPerson, handler)`, `implement(showMe, handler)` and `implement(renamePerson, handler)` from `@house-rules/application` in thin use-cases. Yield `CurrentActor` and pass the Actor to `Party`; `show_me` calls `Party.me(actor)`. Keep the app's Grant at the request boundary: `party:read` for `show_person` and `show_me`, `party:update` for `rename_person`.
6. [ ] Add a view for each failure tag the shipped contracts declare: `PersonNotFound`, `PersonUpdateRefused`, `PersonInputInvalid`, `PersonStoreUnavailable`. A missing view fails `tsc`.
7. [ ] Call `Party.erase(id)` when the app deletes a user, in the same unit.

On rules 0.17.0, a consumer contract that imports this package needs `trustedContractPackages: ["@house-rules/party"]` in its existing `layout(...)` options. Only `/contract` is trusted.

Methods: `createPerson({ displayName, id? })`, `get(actor, id)`, `me(actor)`, `rename(actor, id, displayName)`, `erase(id)`. Times are epoch milliseconds. A display name is trimmed and 1 to 120 characters; anything else fails with `PersonInputInvalid`.

## Fixed rules

- The Person id is the ActorId. Party stores no other identity: no email, no issuer, no subject. Bindings from a login to an ActorId belong to another package.
- `me(actor)` reads the actor's own Person and fails with `PersonNotFound` when the actor has none. `show_me` takes no input, so it can only ever show the caller.
- Anyone may read a person's display name. Only the person may rename themselves; another actor gets `PersonUpdateRefused`, before any row is read. The policy has two relations, `self` and `other`.
- `createPerson`, `rename` and `erase` join an open unit; none starts one. Each fails with `NoOpenUnit` outside it. `rename_person` sets `transactional: true`.
- `createPerson` and `erase` are the two writes with no Actor, and no contract exposes either. The app's first-sign-in filler calls `createPerson`. `erase(id)` is an account-deletion hook, like `Comments.erase`: the app calls it when it deletes a user. It applies no policy, so only trusted app code may call it.
- `PartyPermissions` is `{ read: "party:read", update: "party:update" }`. Deletes are hard.
- The storage port answers facts only. It decides no permission and no limit.
