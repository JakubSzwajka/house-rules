import { Clock, Effect } from "effect";
import { exportJWK, generateKeyPair, type JSONWebKeySet, type JWTPayload, SignJWT } from "jose";

const algorithm = "ES256";
const kid = "house-rules-test";

export type TestKeys = Readonly<{
  jwks: JSONWebKeySet;
  sign: (payload: Readonly<Record<string, unknown>>) => Effect.Effect<string>;
}>;

const keys: Effect.Effect<TestKeys> = Effect.gen(function* () {
  const pair = yield* Effect.promise(() => generateKeyPair(algorithm, { extractable: true }));
  const publicKey = yield* Effect.promise(() => exportJWK(pair.publicKey));
  return {
    jwks: { keys: [{ ...publicKey, kid, alg: algorithm, use: "sig" }] },
    sign: (payload) =>
      Effect.gen(function* () {
        const now = Math.floor((yield* Clock.currentTimeMillis) / 1000);
        const claims: JWTPayload = { iat: now, exp: now + 600, ...payload };
        return yield* Effect.promise(() =>
          new SignJWT(claims).setProtectedHeader({ alg: algorithm, kid }).sign(pair.privateKey),
        );
      }),
  };
});

export const AuthJwtTesting = { keys } as const;
