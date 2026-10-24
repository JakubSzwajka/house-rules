# @house-rules/identity

Identity owns login bindings, passwords and local API tokens. Password, OIDC, Clerk and development providers verify JWTs through auth-jwt. API tokens resolve an actor from Identity's own row. Identity never links by email or learns roles.

```text
Identity.who(options).resolve(incoming)
  token source -> prefix / issuer -> kind admission -> verification
    JWT -> ActorResolver -> known login or FirstSignIn
    API token -> stored actor id
      -> ActorStanding -> required scope -> Actor
```

`Identity.who({ token, accept?, requireScope?, audience?, challenge? })` returns a `WhoSocket<Credentials | ActorResolver | FirstSignIn | ActorStanding>`. It returns an Actor, not request services. Every app must fill `ActorStanding`, using `Identity.standing(Effect.map(Party, (party) => party.standingOf))` or explicit `Identity.everyoneActive` when it has no disabled accounts. Omitting this slot is a type error. Composition's May plug still owns roles.

Mount `Identity.layerPostgres({ providers })` with the shared SQL client, or `Identity.layerMemory({ providers })`. Both fill `ActorResolver`, `Credentials` and the lower `Authenticator` too. Who uses Credentials; the lower Authenticator admits only session and generic JWT credentials. Register the package in `migrations.json`. `Identity.subject({ issuer })` needs no table: it uses the subject as the ActorId for that issuer only. A foreign issuer is refused before the hook runs. `Identity.refuse` fills `FirstSignIn` for invite-only signup.

Exported IdentityMount is a plain `{ service, operations, bind }` value. Add its chosen layer in composition/modules.ts. Composition acquires the services and calls the binder once. For open signup, pass the FirstSignIn slot to a hook way in ways-in/hooks with one system feature, explicit Mean, input and failure mapping. Composition installs it after Runtime and captures that runtime, trace, watch and unit. It calls the app's system-start first-sign-in feature with `May.system`, system permissions and approval; it neither authenticates again nor builds another runtime. That feature creates the Person and calls `IdentityOperations.bindLogin` in one lifted unit. Hook failures map to `Refused`.

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

`signingKey` is a Redacted private P-256 JWK string. Generate one with `PasswordIssuer.newSigningKey` and store it as a secret. Passwords options also accept `audience` and `ttlSeconds`, default 3600. For development only, replace signingKey with `ephemeral: true`. It logs a warning and requires `NODE_ENV`, trimmed and lowercased, to be exactly `development` or `test` in the active ConfigProvider. A host value, when present, must pass the same allowlist. Missing configuration, blank, production, staging and unknown values are refused. Restarting loses those sessions.

OIDC options are auth-jwt's `issuer`, `jwks?`, `jwksUrl?`, `audience?` and `clockTolerance?`, plus `kind?: "session" | "oauth_access"`. Its default kind is `jwt`. Issuers must be unique and at most one passwords provider is allowed. Tokens are routed by issuer, then verified with that provider's keys, issuer, expiry and audience. `Identity.who({ token: ["bearer", { cookie: "booking_session" }] })` accepts either source, bearer first. Keep cookie issuance and CSRF in the HTTP way. `identity.passwordIssuer()` returns the configured signer with public `jwks`, or undefined. It does not publish an HTTP route by itself.

An OIDC-only mount builds without a passwords provider. Password calls then fail with typed `PasswordsUnavailable`; its unused passwords table stays empty. Migration `0002_identity_password_account.sql` adds that table without changing the existing binding migration.

For development/test issuers, add `Identity.devLocal({ issuer: "https://web.invalid" })` to providers. It uses AuthJwtLocal with fresh in-memory keys and requires NODE_ENV, trimmed and lowercased, to be exactly development or test in the active ConfigProvider. A host value, when present, must pass the same allowlist. All other values, including missing configuration, fail with typed IdentityProviderInvalid, kind unavailable. Both devLocal and ephemeral passwords signing reuse auth-jwt's public `requireDevelopmentSigning` guard; AuthJwtLocal also guards its own acquisition. Obtain a signing handle with `(yield* DevLocalIssuers).get(issuer)` and call its `issue(claims)` in tests. Handles belong in composition, never ways. Missing handles fail with the same unavailable error. Restarting invalidates development tokens. The booking example replaces DemoForbidden with IdentityProviderInvalid; both have unavailable kind.

Remote MCP can share Identity's provider list through `Identity.oidc({ issuer: MCP_AUTH_ISSUER })`. Its way still checks configuration and supplies the resource audience and challenge to Identity.who. Unset auth remains 503 not_configured without a challenge, including metadata behavior.

## Credential admission

`accept` defaults to `["session", "jwt"]`. Passwords and devLocal produce `session`; OIDC defaults to `jwt`. OAuth access and local API tokens need explicit admission. `machine` is classified but cannot appear in an accept list.

```ts
const providers = [
  Identity.clerk({ publishableKey, authorizedParties: ["https://app.example"] }),
  Identity.apiTokens({ prefix: "bapp_", hmacKey }), // Redacted<string>
]
const web = Identity.who({ token: { cookie: "__session" }, accept: ["session"] })
const api = Identity.who({ token: "bearer", accept: ["api_token"] })
const writes = Identity.who({ token: "bearer", accept: ["api_token"], requireScope: "write" })
```

Clerk uses `AuthJwt.clerkOptions`, its verifier and `clerkKind`. The preset requires authorized parties and inherits auth-jwt's five-second skew and optional pending-session refusal. A session needs an absent/`JWT` protected-header typ, a `user_` subject and nonempty `sid`. OAuth typ values and `mch_` subjects never become sessions. Impersonation is refused unless `allowImpersonation: true` is explicit. Before production, check that a real instance's session token satisfies this predicate.

A configured opaque prefix wins before JWT decoding. Otherwise only compact JWS tokens route by unverified issuer. There is no fallback verifier. Kind admission runs before verification or a token lookup and repeats against the verified JWT header and claims. First token source wins; a bad bearer does not fall back to a cookie. JWTs always use ActorResolver and FirstSignIn, never their subject as an API-token actor id. `Identity.subject` remains an explicit resolver option.

Standing runs after resolution and before scope checking. Disabled actors get 401 `actor_disabled`, missing actors 401 `token_invalid`, and an unavailable standing check gets 503 `identity_unavailable`. This also protects permission-free person features and in-process calls. Public system features skip Who. Already-admitted work may finish after a disable; writes needing a stronger guarantee must lock the principal in Party.

Missing credentials get 401 `token_missing`; invalid, expired, wrong-kind, revoked, unknown-shape or unknown-issuer credentials get 401 `token_invalid`. JWKS outages get 503 `auth_unavailable`; binding/token-store failures get 503 `identity_unavailable`. An unbound invite-only login gets 403 `not_invited`. Missing `requireScope` gets 403 `scope_too_wide`, before feature input decoding. Scope names are data, not permissions. Who does not change Party roles.

## API tokens

Migration `0003_api_tokens.sql` adds `identity_api_token`. Prefixes end in underscore; configure one API-token provider per Identity mount. Keep its HMAC key secret and stable. Tokens have `<prefix><lookup16>_<secret64>` form. Only the issue result contains the raw secret. Store verification uses HMAC-SHA256 over `token:<secret>`, constant-time WebCrypto verification and dummy work for unknown lookups. Existing rows with that digest format can be seeded unchanged.

| Operation | Input | Permission |
| --- | --- | --- |
| issueToken | `{ actorId, name, scopes, createdBy }` | identity:tokens-issue |
| listTokens | `{ actorId? }` | identity:tokens-read |
| revokeToken | `{ id }` | identity:tokens-revoke |
| recordTokenUse | `{}` | identity:tokens-use |

Facade methods take those values directly; `listTokens(actorId?)`, `revokeToken(id)` and `recordTokenUse()` have no wrapper object. Writes join a unit. Issuance trusts the actor id supplied by an authorized feature or process; it does not inspect Party kind or standing. The app must lock and validate its target before issuing. Lists contain summaries only. Revocation returns `{ before, after, fact }`, null if already revoked, and `TokenNotFound` for an unknown id. It needs approval through its operation descriptor.

Issuance returns `{ token, secret, fact }`. Facts use the framework's `identity.token_issued` with `after: { name, scopes }` and `identity.token_revoked` with `before: { revoked: false }, after: { revoked: true }`. The owner selected these generic names instead of changing the schema under Board's old `token.created` and `token.revoked` names. Board keeps its old kinds registered for seeded history and maps read/write names in its own UI. Identity does not write an event log.

Who cannot write outside a unit. Successful token checks buffer last use in a bounded 1,000-entry map; a system feature can call `recordTokenUse` each minute. A crash loses buffered usage. Removing the API-token provider makes these methods fail with `ApiTokensUnavailable`.

## Session control

`SessionControl.endAll(actorId)` returns `{ ended }`. `identity.endSessions(actorId)` and `IdentityOperations.endSessions` use the configured port; without one they fail `SessionControlUnavailable`. Select the fetch adapter in composition/modules.ts:

```ts
Identity.layerPostgres({ providers }, {
  sessions: Identity.clerkSessions({ issuer, secretKey }), // Redacted<string>, optional fake fetch
})
```

The adapter reads bindings for that issuer only. It lists active sessions in pages of 500, collects every page before revoking, then re-lists. After three revocation rounds, remaining sessions fail with fixed-text `SessionsPartlyEnded { ended, remaining }`. A failed revoke also reports partial progress. A 404 counts as done but not as a successful revoke. Retrying reports only successful revoke calls in that attempt.

Clerk calls cannot roll back with a database unit. Record an app-owned session fact only after success; if recording fails, already-revoked sessions remain revoked. A previously issued JWT can still pass until expiry plus accepted skew, normally up to 65 seconds for Clerk. No Clerk SDK is used.

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
