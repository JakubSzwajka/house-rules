import { Authenticator } from "@house-rules/application";
import { Clock, Effect, Layer } from "effect";
import { createLocalJWKSet, exportJWK, generateKeyPair, type JWTPayload, SignJWT } from "jose";
import { authenticator, issuerUrl } from "../jwt/auth-jwt.ts";
import { AuthJwtConfigInvalid } from "../jwt/config-invalid.ts";
import { AuthJwtLocalIssuer, type LocalIssuerService } from "./local-issuer.ts";
import { requireDevelopmentSigning } from "./development-signing.ts";

const algorithm = "ES256";
const kid = "house-rules-local";
const reservedClaims: ReadonlySet<string> = new Set(["iss", "aud", "exp", "iat", "nbf", "jti"]);

export type AuthJwtLocalOptions = Readonly<{
  issuer?: string;
  audience?: string;
  ttlSeconds?: number;
}>;

export type AuthJwtLocalKit = LocalIssuerService & Readonly<{ layer: Layer.Layer<Authenticator> }>;

const ttlOf = (value: number | undefined) =>
  value === undefined || (Number.isInteger(value) && value > 0)
    ? Effect.succeed(value ?? 3600)
    : Effect.fail(
        new AuthJwtConfigInvalid({
          option: "ttlSeconds",
          message: "ttlSeconds must be a positive whole number of seconds.",
        }),
      );

const make = Effect.fnUntraced(function* (options: AuthJwtLocalOptions = {}) {
  yield* requireDevelopmentSigning(
    () =>
      new AuthJwtConfigInvalid({
        option: "NODE_ENV",
        message: "Development signing requires NODE_ENV development or test.",
      }),
  );
  const issuer = options.issuer ?? "https://dev-issuer.invalid";
  yield* issuerUrl(issuer);
  const ttl = yield* ttlOf(options.ttlSeconds);
  // A fresh key pair per issuer, kept in memory: its tokens die with the process.
  const pair = yield* Effect.promise(() => generateKeyPair(algorithm));
  const publicKey = yield* Effect.promise(() => exportJWK(pair.publicKey));
  const jwks = { keys: [{ ...publicKey, kid, alg: algorithm, use: "sig" }] };
  const verifier = authenticator(
    { issuer, jwks, ...(options.audience === undefined ? {} : { audience: options.audience }) },
    createLocalJWKSet(jwks),
    0,
  );
  const issue: LocalIssuerService["issue"] = (claims) =>
    Effect.gen(function* () {
      const now = Math.floor((yield* Clock.currentTimeMillis) / 1000);
      // Reserved claims are the issuer's alone: a caller cannot mint a token that never expires or names another resource.
      const payload: JWTPayload = {
        ...Object.fromEntries(Object.entries(claims).filter(([name]) => !reservedClaims.has(name))),
        iss: issuer,
        iat: now,
        exp: now + ttl,
        ...(options.audience === undefined ? {} : { aud: options.audience }),
      };
      return yield* Effect.promise(() =>
        new SignJWT(payload).setProtectedHeader({ alg: algorithm, kid }).sign(pair.privateKey),
      );
    });
  const kit: AuthJwtLocalKit = {
    issuer,
    jwks,
    issue,
    layer: Layer.succeed(Authenticator, verifier),
    ...(options.audience === undefined ? {} : { audience: options.audience }),
  };
  return kit;
});

const layer = (
  options: AuthJwtLocalOptions = {},
): Layer.Layer<Authenticator | AuthJwtLocalIssuer, AuthJwtConfigInvalid> =>
  Layer.unwrap(
    Effect.map(make(options), (kit) =>
      Layer.merge(kit.layer, Layer.succeed(AuthJwtLocalIssuer, kit)),
    ),
  );

export const AuthJwtLocal = { make, layer } as const;
