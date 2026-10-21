# @house-rules/auth-jwt: notes for agents

## What it does

It fills the `Authenticator` slot from `@house-rules/application`. `verify(token, { audience? })` checks a JWT's signature against a JSON Web Key Set, its `iss`, a required `exp` and its `nbf`, a non-empty string `sub`, and its `aud` when an audience is set. A good token becomes a `Principal`: `issuer`, `subject`, `audience`, `scopes` and every claim. A bad one fails with `TokenRejected`, whose `reason` is `invalid`, `expired`, `wrong_audience`, `wrong_issuer` or `unavailable` (the key set could not be fetched). It uses `jose` 6.2.12 and keeps it inside this package. It owns no tables, no migrations and no identity: who the subject is in the app is another package's job. Version 0.1.0 is ready for its first npm release, not yet published. It peers on exact `@house-rules/application` 0.2.0, `@house-rules/domain` 0.1.0 and Effect 4.0.3.

## How an app mounts it

1. [ ] Provide one layer in the composition root:

   ```ts
   AuthJwt.layer({ issuer: "https://auth.example.com", audience: "https://app.example/mcp" })
   // or, for Clerk:
   AuthJwt.clerk({ publishableKey })
   ```

2. [ ] Handle `AuthJwtConfigInvalid`, an unavailable-kind acquisition error. The layer fails with it when the issuer is not an absolute http(s) URL, the JWKS URL (explicit, or derived from the issuer) is not https, `clockTolerance` is not a finite, non-negative number, or the Clerk key is not a `pk_test_` or `pk_live_` key.
3. [ ] Fill a way's Who with `Identity.who({ token, audience?, challenge? })` from identity, or a custom `WhoSocket`. It reads the token with `tokenFrom`, verifies it, then resolves the Actor. Rejected tokens become 401 `Refused`; unavailable verification becomes 503. One token source: `tokenFrom(incoming, "bearer")` or `tokenFrom(incoming, { cookie: "__session" })`. Several places, tried in order, first token wins: `tokenFrom(incoming, ["bearer", { cookie: "__session" }])`. List the bearer header first, so a script's header beats a browser's cookie.
4. [ ] In tests, sign tokens with `AuthJwtTesting.keys` and pass its `jwks` to the layer, so no test touches the network.

No `migrations.json` line.

| Option | Default | Effect |
| --- | --- | --- |
| `issuer` | required | the exact `iss` every token carries |
| `audience` | none | the `aud` a token must name; a `verify` call's `audience` wins over it |
| `jwksUrl` | `<issuer>/.well-known/jwks.json` | where the public keys are fetched and cached; https only |
| `jwks` | none | a fixed public key set used instead of `jwksUrl` |
| `clockTolerance` | `0` | seconds of skew allowed on `exp` and `nbf` |

`AuthJwt.clerk({ publishableKey, audience?, clockTolerance?, jwks? })` derives the issuer from the key: the base64 after the prefix is the Frontend API host plus `$`, and the issuer is `https://<host>`. `AuthJwt.clerkIssuer(key)` returns that issuer as an `Option`.

## Local issuer: dev and demos only

`AuthJwtLocal` signs tokens in process so a demo can sign in with no identity provider. Never mount it in production: whoever can call `issue` can sign in as anyone.

- `AuthJwtLocal.make({ issuer?, audience?, ttlSeconds? })` is an `Effect` of `{ issuer, audience?, jwks, issue, layer }`. It makes a fresh ES256 key pair in memory per call, so tokens die with the process and one issuer's tokens fail another's layer.
- `issue({ sub, name?, ...claims })` is an `Effect<string>`. It sets `iss`, `iat`, `exp` (now plus `ttlSeconds`) and `aud` after the given claims, so a caller cannot extend a token. Time comes from `Clock`.
- `layer` is a `Layer<Authenticator>` on the same verify code as `AuthJwt.layer`, with the local key set injected.
- `AuthJwtLocal.layer(options)` provides both `Authenticator` and the `AuthJwtLocalIssuer` service, whose `issue` a test or demo sign-in binding can yield.
- Defaults: issuer `https://dev-issuer.invalid`, no audience, `ttlSeconds` 3600. A bad issuer or a `ttlSeconds` that is not a positive whole number fails with `AuthJwtConfigInvalid`.
- The app keeps it behind an explicit switch, such as `DEMO_ISSUER=1`, and refuses to start with it when `NODE_ENV=production`.

## Fixed rules

- No token passes without a matching signature, issuer, non-empty string subject and unexpired time. A token with no `exp` is refused. There is no option to skip a check.
- The audience is checked only when one is set. An MCP route sets it to its resource URL, so a token for another resource is refused.
- `scope` (space-separated) wins over `scp` (an array or a string). Missing both gives no scopes. Scopes only narrow access; the way's May permission list decides feature access. `defineWay({ features })` and May lists expose features, never module operations.
- `verify` reads the time from Effect's `Clock`, so `TestClock` drives expiry in tests.
- No email, no user lookup and no session issuing here.
- Module user-facing errors keep their messages; unavailable and plumbing errors use fixed public text, with diagnostic details kept in separate fields or causes.
