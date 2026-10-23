# @house-rules/auth-jwt

Fills the `Authenticator` slot from `@house-rules/application` by verifying JWTs against a JSON Web Key Set, with a Clerk preset. Plain JWT works with any OpenID-style issuer that publishes its keys.

```ts
import { AuthJwt } from "@house-rules/auth-jwt";

const authenticator = AuthJwt.layer({ issuer: "https://auth.example.com" });
const clerk = AuthJwt.clerk({ publishableKey: "pk_live_..." });
```

The layer fills the lower `Authenticator` slot, not a way's Who socket. Pair it with `Identity.who({ token, audience?, challenge? })` from identity, or a custom `WhoSocket` that resolves an Actor. Application never imports this plug. The way exposes features through `defineWay({ features })`; May owns feature access separately.

`AuthJwtConfigInvalid` carries unavailable kind for acquisition failures. `verify(token, { audience? })` returns a `Principal` or fails with `TokenRejected`. Keys come from `<issuer>/.well-known/jwks.json` by default, or from `jwksUrl` (https only), or from a fixed `jwks` set. `AuthJwtTesting.keys` gives a local key pair and a signer for tests.

For dev and demos only, never production, `AuthJwtLocal` is a local issuer: an in-memory key pair whose tokens the normal verify path accepts.

```ts
import { AuthJwtLocal, AuthJwtLocalIssuer } from "@house-rules/auth-jwt";

const local = yield* AuthJwtLocal.make({ audience: "http://localhost:3000/api", ttlSeconds: 3600 });
const token = yield* local.issue({ sub: "ada", name: "Ada" }); // Effect<string>
// local.layer: Layer<Authenticator>; local.jwks: the public key set

// or one layer with both the Authenticator and the AuthJwtLocalIssuer service
const dev = AuthJwtLocal.layer({ audience: "http://localhost:3000/api" });
```

Whoever can call `issue` can sign in as anyone. `AuthJwtLocal.make` and `.layer` refuse outside development/test themselves with unavailable `AuthJwtConfigInvalid`. They read NODE_ENV through Effect Config, trim and lowercase it, and accept only `development` or `test`. A host NODE_ENV, when present, must also pass. Missing and blank values refuse.

The public `requireDevelopmentSigning(refused)` helper applies that same guard and returns the caller's typed error from `refused()`. Identity reuses it for devLocal and ephemeral passwords signing.

`issue` drops the reserved claims `iss`, `aud`, `exp`, `iat`, `nbf` and `jti` from the claims you pass. The issuer sets `iss`, `iat` and `exp`, and sets `aud` only when you configured an audience; otherwise the token has no `aud`.

Version 0.1.0 is prepared for its first public release, not yet live on npm. Pin `@house-rules/application` 0.2.0, `@house-rules/domain` 0.1.0 and Effect 4.0.3 exactly. It depends on `jose` 6.2.12. See `AGENTS.md` for options and fixed rules.
