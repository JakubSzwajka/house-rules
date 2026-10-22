# @house-rules/identity

Identity answers how a person proves who they are. It owns `(issuer, subject) -> actor_id` bindings and configurable passwords and OIDC providers. Every provider pairs an issuer with its auth-jwt verifier. Identity never links by email or learns roles.

```text
Identity.who(options).resolve(incoming)
  token source -> Authenticator.verify -> ActorResolver
    known login -> Actor
    unknown login -> FirstSignIn -> Actor
```

`Identity.who({ token, audience?, challenge? })` returns a `WhoSocket<Authenticator | ActorResolver | FirstSignIn>`. Exported `IdentityWhoOptions` describes those options. It returns an Actor, not request services. There is no grant callback. Composition's single May plug resolves Party roles; ways carry no permissions. Construction captures no request context or new-login hook, and verification runs once per resolution.

Mount `Identity.layerPostgres({ providers })` with the shared SQL client, or `Identity.layerMemory({ providers })`. Both fill `ActorResolver` and `Authenticator` too. Register the package in `migrations.json`. `Identity.subject({ issuer })` needs no table: it uses the subject as the ActorId for that issuer only. A foreign issuer is refused before the hook runs. `Identity.refuse` fills `FirstSignIn` for invite-only signup.

Exported IdentityMount is a plain `{ service, operations, bind }` value. Add its chosen layer in composition/modules.ts. Composition acquires the services and calls the binder once. For open signup, build Runtime, then acquire the hook. The hook captures that runtime, trace, watch and unit. It calls the app's system-start first-sign-in feature with `May.system`, system permissions and approval; it neither authenticates again nor builds another runtime. That feature creates the Person and calls `IdentityOperations.bindLogin` in one lifted unit. Hook failures map to `Refused`.

The browser-safe `./contract` door exports binding schemas, errors and `IdentityOperations.bindLogin`. `defineOperation` declares it; `bindIdentity` uses `bindOperation`. The operation is named `Identity.bindLogin`, requires `identity:bind`, has no edges and is transactional. It takes `{ issuer, subject, personId }`, binds the login and returns the ActorId. Person callers get forbidden `IdentityCallerDenied`. App features call this operation through declared edges. Only features are exposed.

Binding methods are `resolve`, `bind`, `unbind`, `bindingsOf` and `unbindAll`, with no Effect requirements. Writes require an open unit, never open one, and retain idempotent same-actor binding and conflict protection. Call `unbindAll` in the account-deletion unit.

Trusted tooling can call the read-only facade method `identity.accountByEmail(email: string)`. It returns `Effect<{ accountId: string; actorId: ActorId; displayName: string }, PasswordAccountNotFound | AccountStoreUnavailable>` with no requirements. It trims and lowercases the email like sign-in, then resolves the account's binding under the configured passwords issuer. Invalid, unknown or unbound emails and mounts without passwords fail with `PasswordAccountNotFound`. It never links accounts by email and is not an operation exposed to features.

## Providers

```ts
Identity.layerPostgres({
  providers: [
    Identity.passwords({ issuer: "https://app.example", signingKey }),
    Identity.oidc({ issuer: "https://login.example", jwks, audience: "web" }),
  ],
})
```

`signingKey` is a Redacted private P-256 JWK string. Generate one with `PasswordIssuer.newSigningKey` and store it as a secret. Passwords options also accept `audience` and `ttlSeconds`, default 3600. For development only, replace signingKey with `ephemeral: true`. It logs a warning and refuses `NODE_ENV=production`. Restarting loses those sessions.

OIDC options are auth-jwt's `issuer`, `jwks?`, `jwksUrl?`, `audience?` and `clockTolerance?`. Issuers must be unique and at most one passwords provider is allowed. Tokens are routed by issuer, then verified with that provider's keys, issuer, expiry and audience. `Identity.who({ token: ["bearer", { cookie: "booking_session" }] })` accepts either source, bearer first. Keep cookie issuance and CSRF in the HTTP way. `identity.passwordIssuer()` returns the configured signer with public `jwks`, or undefined. It does not publish an HTTP route by itself.

An OIDC-only mount builds without a passwords provider. Password calls then fail with typed `PasswordsUnavailable`; its unused passwords table stays empty. Migration `0002_identity_password_account.sql` adds that table without changing the existing binding migration.

## Password operations

`bindIdentity(service)` binds every `IdentityOperations` descriptor, including:

| Operation | Input | Output | Permission |
| --- | --- | --- | --- |
| signUp | `{ email, password, displayName }` | `{ accountId, token, expiresAt }` | identity:create |
| signIn | `{ email, password }` | `{ token, expiresAt }` or `{ _tag: "InvalidCredentials" }` | identity:sign-in |
| changePassword | `{ current, next }` | `{ _tag: "PasswordChanged" }` or `{ _tag: "InvalidCredentials" }` | identity:update |

All three join an open unit. Refusals are data, not failures, so attempts commit. Password change resolves only the caller's own passwords binding. Sign-out belongs to the HTTP way: clearing its cookie cannot revoke copied bearer tokens.

Sign-in conceals account existence; sign-up does not. As in v1, a registered email returns conflict 409 `AccountEmailTaken`. Apps that need protection against sign-up enumeration add email verification or rate limiting.

Passwords must have 10 to 200 Unicode code points after NFKC normalization.

The passwords subject retains PBKDF2-SHA256 at 600,000 iterations, dummy hashing for unknown emails, random salts and constant-time comparison. Five failed attempts lock for 15 minutes; admission rechecks the lock and stored hash after hashing. Shared memory and real Postgres suites cover counts, races, hash upgrades and rollback through MigrationsTesting.

Version 0.1.0 is prepared for its first release. Pin domain 0.1.0, application 0.2.0 and Effect 4.0.3 exactly. Published packages load built `dist/`; this workspace loads source. See [AGENTS.md](AGENTS.md) for refusal codes, mounting and tests.
