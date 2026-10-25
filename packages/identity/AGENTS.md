# @house-rules/identity: notes for agents

## What it does

Identity owns login providers and maps each verified `(issuer, subject)` pair to an `ActorId`. It owns `identity_binding`, `identity_password_account` and `identity_api_token`. Choose passwords for email/password sessions, OIDC for an outside issuer, Clerk for kind-checked Clerk JWTs, API tokens for local opaque credentials, and devLocal for development/test issuers. Each provider pairs its issuer with an auth-jwt verifier. One actor may have many bindings. Identity never links by email or learns roles. `Identity.who` resolves the Actor for a way. Version 0.1.0 peers on exact domain 0.1.0, application 0.2.0 and Effect 4.0.3. Published packages load built `dist/`; the workspace loads source.

## Mount and bind

1. [ ] Mount `Identity.layerPostgres({ providers })` with the shared SQL client, or `Identity.layerMemory({ providers })` in tests. Both provide `Identity`, `ActorResolver`, `Credentials` and `Authenticator`. Use `Identity.passwords({ issuer, signingKey })` with a Redacted private P-256 JWK and/or `Identity.oidc({ issuer, jwks?, jwksUrl?, audience? })`. Provider issuers must be unique; only one passwords provider is allowed. No passwords provider means password methods fail with typed `PasswordsUnavailable`. Raw `Identity.layer` needs `BindingStore` and optionally captures `AccountStore` and `PasswordIssuer` for adapter tests. For one issuer with no table, `Identity.subject({ issuer })` treats its subject as the ActorId. A foreign issuer is refused before the new-login hook.
2. [ ] With bindings, register `{ "package": "@house-rules/identity" }` in `migrations.json`, or `{ "workspace": "packages/identity" }` in this repo.
3. [ ] Import IdentityMount from main and add `{ ...IdentityMount, layer: chosenIdentityLayer }` to the app's module plan. Composition acquires Identity and calls its binder once. Standalone Runtime.layer accepts mounts and requires their services. The browser-safe `./contract` door exports binding schemas/errors and `IdentityOperations`; main adds services, ports, adapters and the binder.
4. [ ] Fill `FirstSignIn`. `Identity.refuse` answers 403 `not_invited`. For open signup, re-export the tag from composition/sign-in.ts as FirstSignInSlot and pass it to `defineWay({ protocol: "hook", name, slot: FirstSignInSlot, features: [F], mean, input, failure })` in ways-in/hooks. F is a system-start feature returning ActorId. It creates the person and login binding in one lifted unit. The kit captures Runtime, trace, watch and unit after acquisition, supplies May.system and fresh request ids, and strips person/MCP authority. Use explicit Mean.allow only for approved trusted provisioning. Map failures to a fixed Refused; never authenticate again.
5. [ ] Keep the configured `Credentials`, resolver and hook in the final root layer. Fill the required `ActorStanding` slot using `Identity.standing(Effect.map(Party, (party) => party.standingOf))`, or explicit `Identity.everyoneActive` for apps without disabled accounts. Fill a way's Who with `Identity.who({ token: "bearer", accept?, requireScope?, audience?, challenge? })`. Cookie sources and ordered token sources work too. Composition plugs one Party.may() for roles. Identity knows no roles, and ways carry no permissions. Lower-level custom mounts use `Identity.providers(options)` with an ApiTokenStore; Who no longer reads a standalone Authenticator.
6. [ ] Call `identity.unbindAll(actorId)` in the account-deletion unit.

## Development providers

`Identity.devLocal({ issuer })` returns `{ kind: "devLocal", issuer }` for the providers list. It uses AuthJwtLocal with fresh in-memory keys, routes verification by issuer and requires NODE_ENV, trimmed and lowercased, to be exactly development or test in the active ConfigProvider. A host value, when present, must pass the same allowlist. All other values, including missing configuration, fail with typed IdentityProviderInvalid, kind unavailable. The allowlist lives in auth-jwt's public `requireDevelopmentSigning` guard, shared by devLocal, ephemeral passwords signing and AuthJwtLocal's own acquisition. `DevLocalIssuers` exposes `get(issuer): Effect<AuthJwtLocalKit, IdentityProviderInvalid>` for development/test signing. Define all providers and each way's Who in composition/sign-in.ts; pass resolved host settings from app.ts and provider options to modules.ts, which alone chooses module layers. Export test handles through sign-in.ts, never ways. A missing handle also fails with IdentityProviderInvalid. The booking app's former DemoForbidden is replaced by this unavailable provider error; no error kind changed.

Remote MCP uses `Identity.oidc({ issuer: MCP_AUTH_ISSUER })` in the same providers list. Keep the way-level configured check, resource audience and challenge in Identity.who. An unset MCP issuer still returns 503 not_configured without a challenge; sharing verifiers does not relax admission.

## Who contract

`IdentityWhoOptions` has `token`, optional `accept`, `requireScope`, `audience` and `challenge`. There is no grant callback. `accept` defaults to `["session", "jwt"]`; `oauth_access` and `api_token` require opt-in, and `machine` is never admissible.

`Identity.who(options)` returns `WhoSocket<Credentials | ActorResolver | FirstSignIn | ActorStanding>`. It checks a configured API-token prefix before any JWT decode, otherwise routes compact JWS by issuer. It checks kind admission before verification or a token-store read and again on verified JWT claims/header. Only API-token credentials can carry a resolved actor id. JWT logins still use ActorResolver and FirstSignIn. Standing runs before scope and before any feature, including permission-free person features and Next call(). Public system starts skip Who. Construction captures no request services. A hook must not authenticate again or build another runtime.

| Refusal | Status / code |
| --- | --- |
| missing token | 401 `token_missing`, optional bare challenge |
| invalid, expired, wrong issuer/audience | 401 `token_invalid`, optional invalid_token challenge |
| authenticator unavailable | 503 `auth_unavailable`, no challenge |
| binding lookup unavailable | 503 `identity_unavailable`, no challenge |
| invite-only unknown login | 403 `not_invited` |
| token-store or standing unavailable | 503 `identity_unavailable`, no challenge |
| disabled actor | 401 `actor_disabled` |
| missing actor | 401 `token_invalid` |
| missing required scope | 403 `scope_too_wide` |

## Clerk, API tokens and sessions

`Identity.clerk({ publishableKey, authorizedParties, rejectPending?, allowImpersonation?, jwks? })` reuses AuthJwt.clerkOptions, verifier and clerkKind. Impersonation is off by default. Production release needs a real session-token shape check. OIDC defaults to `jwt`; its factory accepts `kind: "session" | "oauth_access"`. Passwords and devLocal produce session credentials.

`Identity.apiTokens({ prefix, hmacKey })` takes a Redacted HMAC key and an underscore-ended prefix. One provider per mount. Migration 0003 adds the token table; do not edit old migrations. Tokens use `<prefix><lookup16>_<secret64>`. HMAC input is exactly `token:<secret>`; use WebCrypto verify, including dummy verification for unknown lookups. Never expose a stored hash in summaries or log a token.

`issueToken({ actorId, name, scopes, createdBy })`, `listTokens(actorId?)`, `revokeToken(id)` and `recordTokenUse()` are facade methods and corresponding IdentityOperations. Permissions are `identity:tokens-issue`, `identity:tokens-read`, `identity:tokens-revoke` and `identity:tokens-use`. Writes join a unit. Issuance trusts its supplied target; app policy must validate and lock that principal first. Revocation needs approval, returns a change once, null for an already-revoked token and not_found for an unknown id. Facts are `identity.token_issued` with `after: { name, scopes }` and `identity.token_revoked` with before/after revoked booleans. Do not reuse Board's legacy event names with changed payload schemas. The composing feature chooses which facts to record.

Who only buffers last use, at most 1,000 ids. Flush through recordTokenUse in a scheduled system feature's unit. A crash loses the buffer; no write is allowed during Who.

`SessionControl.endAll(actorId)` is a caller-owned port. Pass `{ sessions: Identity.clerkSessions({ issuer, secretKey, pageSize?, fetch? }) }` as the second argument to layerMemory/layerPostgres. The adapter captures the same BindingStore as Identity. `identity.endSessions(actorId)` and IdentityOperations.endSessions require that adapter; otherwise they fail unavailable. The operation requires `identity:sessions-end`, a unit and approval. The adapter uses plain fetch, reads only the selected issuer's bindings, lists status=active in pages of 500 by default before revoking, and re-lists for up to three rounds. Optional pageSize must be an integer from 1 to 500; invalid values fail layer construction with typed IdentityProviderInvalid, option pageSize, before any fetch. A 404 is done but does not increase ended. Partial failures retain external revocations and return fixed-text unavailable errors with progress. Only success returns `{ ended }`; apps record their session fact after success, knowing neither the Clerk calls nor a later event failure can restore sessions. See README for retry and expiry limits.

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
