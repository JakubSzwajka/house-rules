# @house-rules/identity: notes for agents

## What it does

Identity owns login providers and maps each verified `(issuer, subject)` pair to an `ActorId`. It owns `identity_binding` and `identity_password_account`. Choose passwords for email/password sessions, OIDC for an outside issuer, and devLocal for development/test issuers. Each provider pairs its issuer with an auth-jwt verifier. One actor may have many bindings. Identity never links by email or learns roles. `Identity.who` resolves the Actor for a way. Version 0.1.0 peers on exact domain 0.1.0, application 0.2.0 and Effect 4.0.3. Published packages load built `dist/`; the workspace loads source.

## Mount and bind

1. [ ] Mount `Identity.layerPostgres({ providers })` with the shared SQL client, or `Identity.layerMemory({ providers })` in tests. Both provide `Identity`, `ActorResolver` and `Authenticator`. Use `Identity.passwords({ issuer, signingKey })` with a Redacted private P-256 JWK and/or `Identity.oidc({ issuer, jwks?, jwksUrl?, audience? })`. Provider issuers must be unique; only one passwords provider is allowed. No passwords provider means password methods fail with typed `PasswordsUnavailable`. Raw `Identity.layer` needs `BindingStore` and optionally captures `AccountStore` and `PasswordIssuer` for adapter tests. For one issuer with no table, `Identity.subject({ issuer })` treats its subject as the ActorId. A foreign issuer is refused before the new-login hook.
2. [ ] With bindings, register `{ "package": "@house-rules/identity" }` in `migrations.json`, or `{ "workspace": "packages/identity" }` in this repo.
3. [ ] Import IdentityMount from main and add `{ ...IdentityMount, layer: chosenIdentityLayer }` to the app's module plan. Composition acquires Identity and calls its binder once. Standalone Runtime.layer accepts mounts and requires their services. The browser-safe `./contract` door exports binding schemas/errors and `IdentityOperations`; main adds services, ports, adapters and the binder.
4. [ ] Fill `FirstSignIn`. `Identity.refuse` answers 403 `not_invited`. For open signup, re-export the tag from composition/sign-in.ts as FirstSignInSlot and pass it to `defineWay({ protocol: "hook", name, slot: FirstSignInSlot, features: [F], mean, input, failure })` in ways-in/hooks. F is a system-start feature returning ActorId. It creates the person and login binding in one lifted unit. The kit captures Runtime, trace, watch and unit after acquisition, supplies May.system and fresh request ids, and strips person/MCP authority. Use explicit Mean.allow only for approved trusted provisioning. Map failures to a fixed Refused; never authenticate again.
5. [ ] Keep the configured provider `Authenticator` and the resolver/hook in the final root layer. A binding-only mount can instead receive a separate Authenticator. Fill a way's Who with `Identity.who({ token: "bearer", audience?, challenge? })`. Cookie sources and ordered token sources work too. Composition plugs one Party.may() for roles. Identity knows no roles, and ways carry no permissions.
6. [ ] Call `identity.unbindAll(actorId)` in the account-deletion unit.

## Development providers

`Identity.devLocal({ issuer })` returns `{ kind: "devLocal", issuer }` for the providers list. It uses AuthJwtLocal with fresh in-memory keys, routes verification by issuer and requires NODE_ENV, trimmed and lowercased, to be exactly development or test in the active ConfigProvider. A host value, when present, must pass the same allowlist. All other values, including missing configuration, fail with typed IdentityProviderInvalid, kind unavailable. `DevLocalIssuers` exposes `get(issuer): Effect<AuthJwtLocalKit, IdentityProviderInvalid>` for development/test signing. Define all providers and each way's Who in composition/sign-in.ts; pass resolved host settings from app.ts and provider options to modules.ts, which alone chooses module layers. Export test handles through sign-in.ts, never ways. A missing handle also fails with IdentityProviderInvalid. The booking app's former DemoForbidden is replaced by this unavailable provider error; no error kind changed.

Remote MCP uses `Identity.oidc({ issuer: MCP_AUTH_ISSUER })` in the same providers list. Keep the way-level configured check, resource audience and challenge in Identity.who. An unset MCP issuer still returns 503 not_configured without a challenge; sharing verifiers does not relax admission.

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

Binding methods are `resolve`, `bind`, `unbind`, `bindingsOf`, `unbindAll`. Password methods are `signUp`, `signIn`, `changePassword`; `passwordIssuer()` returns the configured signer/JWKS or undefined. They return Effects with no requirements. Writes join an open unit and fail `NoOpenUnit` outside one; the module never opens a unit.

`IdentityOperations.bindLogin`, declared with `defineOperation` and named `Identity.bindLogin`, takes `{ issuer, subject, personId }` and returns that ActorId after binding. Permission is `identity:bind`; flags are transactional true, all others false; edges are empty. A person caller gets forbidden `IdentityCallerDenied`. `bindIdentity` uses `bindOperation`. App features call this operation through declared edges. Only features are exposed.

`identity.accountByEmail(email: string)` returns `Effect<{ accountId: string; actorId: ActorId; displayName: string }, PasswordAccountNotFound | AccountStoreUnavailable>` with no requirements. It trims and lowercases email like sign-in and resolves only the configured passwords issuer's binding. Invalid, unknown or unbound emails and mounts without passwords return not_found. This read-only facade method is for trusted tooling, not an operation exposed to features. It never links accounts by email.

- Sign-in conceals account existence; sign-up does not. The v1 contract keeps conflict 409 `AccountEmailTaken` for a registered email. Apps that need protection against sign-up enumeration add email verification or rate limiting.
- Password length is 10 to 200 Unicode code points after NFKC normalization.
- Binding the same login to its current actor is a no-op. Binding it to another fails with conflict `BindingTaken`.
- Empty issuer/subject fails with invalid `BindingInvalid` and never resolves. `unbind(actorId, login)` removes only that actor's binding.
- `actor_id` is a plain column, not a cross-module foreign key. Deleting a binding never deletes another module's data.
- Storage failures have unavailable kind; `ForeignIssuer` has forbidden kind but Who preserves its 401 auth translation.
- Module user-facing errors keep their messages; unavailable and plumbing errors use fixed public text, with diagnostic details kept in separate fields or causes.

`IdentityOperations.signUp`, `.signIn` and `.changePassword` require `identity:create`, `identity:sign-in` and `identity:update`. All are transactional. `bindIdentity` includes their bindings and resolves password changes through the caller's own login binding. Refused sign-in and password changes return generic data so lock counts commit. Sign-out clears the way's cookie and needs no module operation; copied bearer tokens remain valid until expiry.

The passwords subject uses PBKDF2-SHA256 with 600,000 iterations, random salts, dummy work for unknown emails and constant-time comparison. Five failures lock for 15 minutes. Conditional admission rechecks lock and hash after hashing. Writes join the caller's unit. Migration 0002 adds the passwords table even for OIDC-only apps; 0001 stays unchanged. `Identity.passwords({ issuer, ephemeral: true })` warns and loses sessions on restart; it uses the same normalized development/test allowlist for the active ConfigProvider and any host NODE_ENV. Missing configuration and all other values refuse signing with PasswordIssuerConfigInvalid. Generate a stable Redacted JWK with `PasswordIssuer.newSigningKey`. Never log keys, passwords or tokens.

Run package `typecheck`, `test` and `build`. The store suite covers memory and real Postgres; Who tests cover token security, hook behavior and rollback.
