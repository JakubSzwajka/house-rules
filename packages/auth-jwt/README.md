# @house-rules/auth-jwt

Fills the `Authenticator` slot from `@house-rules/application` by verifying JWTs against a JSON Web Key Set, with a Clerk preset. Plain JWT works with any OpenID-style issuer that publishes its keys.

```ts
import { AuthJwt } from "@house-rules/auth-jwt";

const authenticator = AuthJwt.layer({ issuer: "https://auth.example.com" });
const clerk = AuthJwt.clerk({ publishableKey: "pk_live_..." });
```

`verify(token, { audience? })` returns a `Principal` or fails with `TokenRejected`. Keys come from `<issuer>/.well-known/jwks.json` by default, or from `jwksUrl` (https only), or from a fixed `jwks` set. `AuthJwtTesting.keys` gives a local key pair and a signer for tests.

Version 0.1.0 is prepared for its first public release, not yet live on npm. Pin `@house-rules/application` 0.2.0, `@house-rules/domain` 0.1.0 and Effect 4.0.3 exactly. It depends on `jose` 6.2.12. See `AGENTS.md` for options and fixed rules.
