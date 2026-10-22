import { describe, expect, it } from "@effect/vitest";
import { Authenticator, TokenRejected } from "@house-rules/application";
import { AuthJwt } from "@house-rules/auth-jwt";
import { Effect, Exit, Layer, Redacted } from "effect";
import { TestClock } from "effect/testing";
import { decodeJwt, decodeProtectedHeader } from "jose";
import {
  PasswordIssuer,
  PasswordIssuerConfigInvalid,
  type PasswordIssuerService,
} from "../index.js";

const issuerUrl = "https://accounts.example.test";

const issuerOf = <E>(layer: Layer.Layer<PasswordIssuer, E>) =>
  Effect.gen(function* () {
    return yield* PasswordIssuer;
  }).pipe(Effect.provide(layer));

const verify = (issuer: PasswordIssuerService, token: string) =>
  Effect.gen(function* () {
    return yield* (yield* Authenticator).verify(token);
  }).pipe(Effect.provide(AuthJwt.layer({ issuer: issuer.issuer, jwks: issuer.jwks })));

describe("PasswordIssuer", () => {
  it.effect("a signed token verifies through AuthJwt.layer with its public key set", () =>
    Effect.gen(function* () {
      const issuer = yield* issuerOf(PasswordIssuer.ephemeral({ issuer: issuerUrl }));
      const { token, expiresAt } = yield* issuer.sign("account-1", { name: "Ada" });
      const principal = yield* verify(issuer, token);
      expect(principal).toMatchObject({
        issuer: issuerUrl,
        subject: "account-1",
        claims: { name: "Ada" },
      });
      expect(expiresAt).toBe(3600 * 1000);
      expect(issuer.jwks.keys).toHaveLength(1);
      expect(issuer.jwks.keys[0]).not.toHaveProperty("d");
      expect(decodeProtectedHeader(token)).toMatchObject({
        alg: "ES256",
        kid: issuer.jwks.keys[0]?.kid,
      });
    }),
  );

  it.effect("reserved claims from the caller never survive", () =>
    Effect.gen(function* () {
      const issuer = yield* issuerOf(
        PasswordIssuer.ephemeral({ issuer: issuerUrl, audience: "https://app.example.test/api" }),
      );
      const reserved = {
        iss: "https://evil.example",
        sub: "someone-else",
        aud: "https://evil.example",
        exp: 9_999_999_999,
        iat: 1,
        nbf: 1,
        jti: "mine",
      };
      const claims = decodeJwt((yield* issuer.sign("account-1", reserved)).token);
      expect(claims).toMatchObject({
        iss: issuerUrl,
        sub: "account-1",
        aud: "https://app.example.test/api",
        iat: 0,
        exp: 3600,
      });
      expect(claims).not.toHaveProperty("nbf");
      expect(claims).not.toHaveProperty("jti");
    }),
  );

  it.effect("a token past its ttl is expired", () =>
    Effect.gen(function* () {
      const issuer = yield* issuerOf(
        PasswordIssuer.ephemeral({ issuer: issuerUrl, ttlSeconds: 60 }),
      );
      const { token } = yield* issuer.sign("account-1");
      yield* TestClock.adjust("61 seconds");
      expect(yield* Effect.exit(verify(issuer, token))).toEqual(
        Exit.fail(new TokenRejected({ reason: "expired" })),
      );
    }),
  );

  it.effect("the same signing key verifies across restarts; another key does not", () =>
    Effect.gen(function* () {
      const signingKey = yield* PasswordIssuer.newSigningKey;
      const before = yield* issuerOf(PasswordIssuer.layer({ issuer: issuerUrl, signingKey }));
      const after = yield* issuerOf(PasswordIssuer.layer({ issuer: issuerUrl, signingKey }));
      const { token } = yield* before.sign("account-1");
      expect((yield* verify(after, token)).subject).toBe("account-1");
      expect(after.jwks).toEqual(before.jwks);
      const other = yield* issuerOf(PasswordIssuer.ephemeral({ issuer: issuerUrl }));
      expect(yield* Effect.exit(verify(other, token))).toEqual(
        Exit.fail(new TokenRejected({ reason: "invalid" })),
      );
    }),
  );

  it.effect("a bad key, issuer or ttl fails with PasswordIssuerConfigInvalid, quoting no key", () =>
    Effect.gen(function* () {
      const secret = "do-not-print-me";
      const publicOnly = JSON.stringify({ kty: "EC", crv: "P-256", x: secret, y: secret });
      const badD = JSON.stringify({ kty: "EC", crv: "P-256", x: secret, y: secret, d: secret });
      const cases = [
        [{ issuer: issuerUrl, signingKey: Redacted.make(`not json ${secret}`) }, "signingKey"],
        [{ issuer: issuerUrl, signingKey: Redacted.make(publicOnly) }, "signingKey"],
        [{ issuer: issuerUrl, signingKey: Redacted.make(badD) }, "signingKey"],
        [{ issuer: "accounts", signingKey: yield* PasswordIssuer.newSigningKey }, "issuer"],
        [
          { issuer: issuerUrl, ttlSeconds: 0, signingKey: yield* PasswordIssuer.newSigningKey },
          "ttlSeconds",
        ],
      ] as const;
      for (const [options, option] of cases) {
        const failure = yield* Effect.flip(issuerOf(PasswordIssuer.layer(options)));
        expect(failure).toBeInstanceOf(PasswordIssuerConfigInvalid);
        expect(failure.option).toBe(option);
        expect(JSON.stringify(failure)).not.toContain(secret);
      }
    }),
  );

  it.effect("a new signing key is a private P-256 JWK with a key id", () =>
    Effect.gen(function* () {
      const jwk: unknown = JSON.parse(Redacted.value(yield* PasswordIssuer.newSigningKey));
      expect(jwk).toMatchObject({ kty: "EC", crv: "P-256" });
      expect(jwk).toHaveProperty("d");
      expect(jwk).toHaveProperty("kid");
    }),
  );
});

it.effect("the issuer layer joins an app layer with no other requirement", () =>
  Effect.gen(function* () {
    const issuer = yield* PasswordIssuer;
    expect(issuer.ttlSeconds).toBe(3600);
  }).pipe(Effect.provide(Layer.orDie(PasswordIssuer.ephemeral({ issuer: issuerUrl })))),
);
