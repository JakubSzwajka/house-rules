# @house-rules/auth-jwt: notes for agents

## What it does

It fills the `Authenticator` slot from `@house-rules/application`. `verify(token, { audience? })` checks a JWT's signature against a JSON Web Key Set, its `iss`, a required `exp` and its `nbf`, a non-empty string `sub`, and its `aud` when an audience is set. A good token becomes a `Principal`: `issuer`, `subject`, `audience`, `scopes` and every claim. A bad one fails with `TokenRejected`, whose `reason` is `invalid`, `expired`, `wrong_audience`, `wrong_issuer` or `unavailable` (the key set could not be fetched). It uses `jose` 6.2.12. Identity also uses jose for its passwords issuer; auth-jwt remains the pure token checker. It owns no tables, no migrations and no identity: who the subject is in the app is another package's job. Version 0.1.0 is ready for its first npm release, not yet published. It peers on exact `@house-rules/application` 0.2.0, `@house-rules/domain` 0.2.0 and Effect 4.0.3.

## How an app mounts it

1. [ ] For identity providers, choose `Identity.passwords(...)` or `Identity.oidc(...)` in Identity's options. Identity builds the matching auth-jwt verifier once. Direct uses, such as a separate MCP resource verifier, still provide one layer in the composition root:

   ```ts
   AuthJwt.layer({ issuer: "https://auth.example.com", audience: "https://app.example/mcp" })
   // or, for Clerk:
   AuthJwt.clerk({ publishableKey, authorizedParties: ["https://app.example.com"] })
   ```

2. [ ] Handle `AuthJwtConfigInvalid`, an unavailable-kind acquisition error. The layer fails with it when the issuer is not an absolute http(s) URL, the JWKS URL (explicit, or derived from the issuer) is not https, `clockTolerance` is not a finite, non-negative number, the Clerk key is not a `pk_test_` or `pk_live_` key, or the Clerk `authorizedParties` list is empty or contains blank values.
3. [ ] Fill a way's Who with `Identity.who({ token, audience?, challenge? })` from identity, or a custom `WhoSocket`. It reads the token with `tokenFrom`, verifies it, then resolves the Actor. Rejected tokens become 401 `Refused`; unavailable verification becomes 503. One token source: `tokenFrom(incoming, "bearer")` or `tokenFrom(incoming, { cookie: "__session" })`. Several places, tried in order, first token wins: `tokenFrom(incoming, ["bearer", { cookie: "__session" }])`. List the bearer header first, so a script's header beats a browser's cookie.
4. [ ] In tests, sign tokens with `AuthJwtTesting.keys` and pass its `jwks` to the layer, so no test touches the network. `keys.sign(claims, header?)` accepts protected-header fields for locally signed kind fixtures.

No `migrations.json` line.

| Option | Default | Effect |
| --- | --- | --- |
| `issuer` | required | the exact `iss` every token carries |
| `audience` | none | the `aud` a token must name; a `verify` call's `audience` wins over it |
| `jwksUrl` | `<issuer>/.well-known/jwks.json` | where the public keys are fetched and cached; https only |
| `jwks` | none | a fixed public key set used instead of `jwksUrl` |
| `clockTolerance` | `0`, Clerk `5` | seconds of skew allowed on `exp` and `nbf` |
| `authorizedParties` | none; required by Clerk | a present `azp` must be a string exactly matching a listed value; absent `azp` passes |
| `rejectPending` | `false` | reject `sts = pending` when true |

`AuthJwt.clerk({ publishableKey, authorizedParties, audience?, clockTolerance?, jwks?, rejectPending? })` derives the issuer from the key: the base64 after the prefix is the Frontend API host plus `$`, and the issuer is `https://<host>`. JWKS comes from `<issuer>/.well-known/jwks.json` unless `jwks` is supplied. The authorized-party list must contain at least one nonblank string. `AuthJwt.clerkIssuer(key)` returns that issuer as an `Option`.

### Providers needing the protected header

`AuthJwt.verifier(options)` is an `Effect<AuthJwtVerifier, AuthJwtConfigInvalid>`. Acquire it once. Its `verify(token, { audience? })` returns an Effect of `{ header, principal }`, failing with `TokenRejected`. The header is jose's verified `protectedHeader`, never unverified decoded input. `AuthJwt.layer` wraps this verifier and drops the header; its Principal-only contract is unchanged.

`AuthJwt.clerkOptions(ClerkOptions)` is an Effect of `AuthJwtOptions`. It validates the publishable key, nonempty authorized-party list and clock tolerance, and derives issuer, JWKS URL and the 5-second default. Identity's Clerk provider must reuse this function instead of copying the defaults.

Apply pure `AuthJwt.clerkKind(header, principal.claims)` only after verification. It returns `oauth_access` for `typ` exactly `at+jwt` or `application/at+jwt`, then `machine` for `sub` starting `mch_`. A session requires `typ` absent or exactly `JWT`, `sub` starting `user_`, a nonempty string `sid` and no `act` claim. Anything else is `unknown`, which the caller must refuse. The classifier neither accepts impersonation nor chooses what a way admits. Any explicit impersonation override belongs to identity.

The Clerk rules follow the accepted identity proposal's C1, C3, C4, C10 and C28 facts. Before production use, verify a real session token's header and claims against the predicate. Local fixtures are not proof of a production instance's token shape.

## Local issuer: dev and demos only

`AuthJwtLocal` signs tokens in process so a demo can sign in with no identity provider. Never mount it in production: whoever can call `issue` can sign in as anyone.

- `AuthJwtLocal.make({ issuer?, audience?, ttlSeconds? })` is an `Effect` of `{ issuer, audience?, jwks, issue, layer }`. It makes a fresh ES256 key pair in memory per call, so tokens die with the process and one issuer's tokens fail another's layer.
- `issue({ sub, name?, ...claims })` is an `Effect<string>`. It sets `iss`, `iat`, `exp` (now plus `ttlSeconds`) and `aud` after the given claims, so a caller cannot extend a token. Time comes from `Clock`.
- `layer` is a `Layer<Authenticator>` on the same verify code as `AuthJwt.layer`, with the local key set injected.
- `AuthJwtLocal.layer(options)` provides both `Authenticator` and the `AuthJwtLocalIssuer` service, whose `issue` a test or demo sign-in binding can yield.
- Defaults: issuer `https://dev-issuer.invalid`, no audience, `ttlSeconds` 3600. A bad issuer or a `ttlSeconds` that is not a positive whole number fails with `AuthJwtConfigInvalid`.
- `make` and `layer` refuse outside development/test themselves with unavailable `AuthJwtConfigInvalid`, option `NODE_ENV`. Effect Config reads NODE_ENV; after trimming and lowercasing, only development or test passes. Missing and blank values refuse. A host NODE_ENV, when present, must pass too.
- The public `requireDevelopmentSigning(refused)` helper implements this guard and raises the caller's typed `refused()` error. Identity reuses it for devLocal and ephemeral passwords signing.

## Fixed rules

- No token passes without a matching signature, issuer, non-empty string subject and unexpired time. A token with no `exp` is refused. There is no option to skip a check.
- The audience is checked only when one is set. An MCP route sets it to its resource URL, so a token for another resource is refused.
- `scope` (space-separated) wins over `scp` (an array or a string). Missing both gives no scopes. Scopes are parsed but do not narrow access yet. Token-scope narrowing is a later addition. Composition plugs `Party.may()` once to resolve the person's roles. Ways narrow access only through feature exposure; MCP exposes read features and uses the same roles as HTTP. `defineWay({ features })` exposes features, never module operations.
- `verify` reads the time from Effect's `Clock`, so `TestClock` drives expiry in tests.
- No email, no user lookup and no session issuing here.
- Module user-facing errors keep their messages; unavailable and plumbing errors use fixed public text, with diagnostic details kept in separate fields or causes.
