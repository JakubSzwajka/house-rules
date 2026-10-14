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

2. [ ] Add a view for `AuthJwtConfigInvalid` to the composition's views. The layer fails with it when the issuer is not an absolute http(s) URL, the JWKS URL (explicit, or derived from the issuer) is not https, `clockTolerance` is not a finite, non-negative number, or the Clerk key is not a `pk_test_` or `pk_live_` key.
3. [ ] In the caller, read the token with `tokenFrom(incoming, "bearer")` or `tokenFrom(incoming, { cookie: "__session" })`, call `verify`, and turn `TokenRejected` into a 401 `Refused`.
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

## Fixed rules

- No token passes without a matching signature, issuer, non-empty string subject and unexpired time. A token with no `exp` is refused. There is no option to skip a check.
- The audience is checked only when one is set. An MCP route sets it to its resource URL, so a token for another resource is refused.
- `scope` (space-separated) wins over `scp` (an array or a string). Missing both gives no scopes. Scopes only narrow access; the app's Grant decides.
- `verify` reads the time from Effect's `Clock`, so `TestClock` drives expiry in tests.
- No email, no user lookup and no session issuing here.
