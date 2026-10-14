# @house-rules/identity: notes for agents

## What it does

Turns a verified `Principal` into an `ActorId`, and fills the app's `Caller`. It is provider-neutral: an `Authenticator`, such as `@house-rules/auth-jwt`, checks the token; this package decides who the caller is. The `Identity` module owns the `identity_binding` table, which binds a login, its `(issuer, subject)` pair, to an `ActorId`. One actor may have many bindings. Version 0.1.0 is ready for its first npm release, not yet published. It peers on exact `@house-rules/domain` 0.1.0, `@house-rules/application` 0.2.0 and Effect 4.0.3, and ships built JavaScript and declarations in `dist/`.

Exports: `Identity` (module, with `resolve`, `bind`, `unbind`, `bindingsOf`, `unbindAll`), the `ActorResolver` and `FirstSignIn` slots, the `ForeignIssuer` error an `ActorResolver` fails with for an issuer it does not own, the `BindingStore` port with `memoryBindingStore()` and `postgresBindingStore`, `identityCaller`, and the errors `BindingTaken`, `BindingInvalid` and `IdentityStoreUnavailable`.

## How an app mounts it

1. [ ] Pick how a principal becomes an actor:
   - With bindings: `Identity.layerPostgres` (needs `SqlClient`) or `Identity.layerMemory`. Both provide `Identity` and `ActorResolver`.
   - With no table: `Identity.subject({ issuer })`. The subject is the `ActorId`, for exactly that issuer. Any other issuer is refused 401 `token_invalid` (with the `invalid_token` challenge when one is set) before `FirstSignIn` runs.
2. [ ] Fill `FirstSignIn`, which runs when a login resolves to none:
   - Invite-only: `Identity.refuse`, which answers 403 `not_invited`.
   - Create on first sign-in: write your own filler in the composition root. It opens its own unit, creates the actor id, binds it and returns it. Map every failure to `Refused`.

   ```ts
   const firstSignIn = Layer.effect(FirstSignIn, Effect.gen(function* () {
     const identity = yield* Identity;
     const unitOfWork = yield* UnitOfWork;
     return (principal) =>
       unitOfWork.atomic(Effect.gen(function* () {
         const id = yield* createActorId; // for example Party.createPerson(...)
         yield* identity.bind(principal, id);
         return id;
       })).pipe(Effect.mapError(() => new Refused({ status: 503, code: "sign_in_failed", message: "Try again." })));
   }));
   ```

3. [ ] Provide an `Authenticator`, and build the caller in the composition root:

   ```ts
   const caller = Identity.caller({
     token: "bearer",                 // or { cookie: "session" }
     audience: resource,              // optional, passed to Authenticator.verify
     grant: (actor, principal) => Grant.fromPermissions(permissionsFor(actor, principal)),
     challenge: mcp.challenge,        // optional, from protectedResource(...)
   });
   ```

   The caller needs `Authenticator | ActorResolver | FirstSignIn` from the app layer. It returns `CurrentActor` and `Grant`. `grant` may return a `GrantService` or an `Effect<GrantService, Refused>`.

4. [ ] With bindings, add the module to the root `migrations.json`: `{ "package": "@house-rules/identity" }`. Use `{ "workspace": "packages/identity" }` only in this repo.
5. [ ] Call `Identity.unbindAll(actorId)` when the app deletes an account, in the same unit.
6. [ ] Add views for `Refused` codes your clients see: 401 `token_missing`, 401 `token_invalid`, 503 `auth_unavailable`, 503 `identity_unavailable`, 403 `not_invited`.

## Fixed rules

- Never looks up or links by email. Only `issuer` and `subject` reach storage; claims never do.
- The package never opens a unit of work. `bind`, `unbind` and `unbindAll` join the open unit and fail with `NoOpenUnit` outside one.
- `bind` to the actor that already holds the login is a no-op; to another actor it fails with `BindingTaken`. An empty issuer or subject fails with `BindingInvalid` and never resolves.
- `unbind(actorId, login)` removes the binding only when that actor holds it.
- Deleting a binding never deletes anything in another module. No cross-module foreign keys: `actor_id` is a plain column.
- A missing token: 401 `token_missing`, with `challenge()` when given. A rejected token: 401 `token_invalid`, with `challenge("invalid_token")`. An `unavailable` rejection: 503 `auth_unavailable`. A store failure while resolving: 503 `identity_unavailable`.
- `Identity.caller` is the static name in the class body; it overrides the legacy `Function.caller` on purpose.
