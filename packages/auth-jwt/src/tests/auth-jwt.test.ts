import { describe, expect, it } from "@effect/vitest";
import { Authenticator, TokenRejected } from "@house-rules/application";
import { Effect, Exit, Layer, Option } from "effect";
import { Base64 } from "effect/encoding";
import { TestClock } from "effect/testing";
import { AuthJwt, AuthJwtConfigInvalid, AuthJwtTesting } from "../index.ts";

const issuer = "https://auth.example.com";
const resource = "https://app.example/mcp";

const verifyWith = (
  layer: Layer.Layer<Authenticator, AuthJwtConfigInvalid>,
  token: string,
  audience?: string,
) =>
  Effect.gen(function* () {
    const authenticator = yield* Authenticator;
    return yield* authenticator.verify(token, audience === undefined ? undefined : { audience });
  }).pipe(Effect.provide(layer));

const rejected = (reason: TokenRejected["reason"]) => Exit.fail(new TokenRejected({ reason }));

describe("AuthJwt.layer", () => {
  it.effect("turns a valid token into a Principal", () =>
    Effect.gen(function* () {
      const keys = yield* AuthJwtTesting.keys;
      const token = yield* keys.sign({ iss: issuer, sub: "user_1", aud: resource, org: "acme" });
      const principal = yield* verifyWith(AuthJwt.layer({ issuer, jwks: keys.jwks }), token);
      expect(principal).toMatchObject({
        issuer,
        subject: "user_1",
        audience: [resource],
        scopes: [],
        claims: { sub: "user_1", org: "acme" },
      });
    }),
  );

  it.effect("refuses an expired token, within the clock tolerance only", () =>
    Effect.gen(function* () {
      const keys = yield* AuthJwtTesting.keys;
      const token = yield* keys.sign({ iss: issuer, sub: "user_1" });
      yield* TestClock.adjust("605 seconds");
      const strict = yield* Effect.exit(
        verifyWith(AuthJwt.layer({ issuer, jwks: keys.jwks }), token),
      );
      expect(strict).toEqual(rejected("expired"));
      const lenient = AuthJwt.layer({ issuer, jwks: keys.jwks, clockTolerance: 10 });
      expect((yield* verifyWith(lenient, token)).subject).toBe("user_1");
    }),
  );

  it.effect("refuses a token that is not valid yet", () =>
    Effect.gen(function* () {
      const keys = yield* AuthJwtTesting.keys;
      const token = yield* keys.sign({ iss: issuer, sub: "user_1", nbf: 300 });
      const exit = yield* Effect.exit(
        verifyWith(AuthJwt.layer({ issuer, jwks: keys.jwks }), token),
      );
      expect(exit).toEqual(rejected("invalid"));
    }),
  );

  it.effect("refuses a token from another issuer", () =>
    Effect.gen(function* () {
      const keys = yield* AuthJwtTesting.keys;
      const token = yield* keys.sign({ iss: "https://evil.example", sub: "user_1" });
      const exit = yield* Effect.exit(
        verifyWith(AuthJwt.layer({ issuer, jwks: keys.jwks }), token),
      );
      expect(exit).toEqual(rejected("wrong_issuer"));
    }),
  );

  it.effect("checks the audience from the layer, and a verify call's audience wins", () =>
    Effect.gen(function* () {
      const keys = yield* AuthJwtTesting.keys;
      const token = yield* keys.sign({ iss: issuer, sub: "user_1", aud: [resource, "other"] });
      const forApp = AuthJwt.layer({ issuer, jwks: keys.jwks, audience: resource });
      expect((yield* verifyWith(forApp, token)).audience).toEqual([resource, "other"]);
      expect(yield* Effect.exit(verifyWith(forApp, token, "https://elsewhere.example"))).toEqual(
        rejected("wrong_audience"),
      );
      const forElsewhere = AuthJwt.layer({
        issuer,
        jwks: keys.jwks,
        audience: "https://elsewhere.example",
      });
      expect(yield* Effect.exit(verifyWith(forElsewhere, token))).toEqual(
        rejected("wrong_audience"),
      );
      const noAudience = yield* keys.sign({ iss: issuer, sub: "user_1" });
      expect(yield* Effect.exit(verifyWith(forApp, noAudience))).toEqual(
        rejected("wrong_audience"),
      );
    }),
  );

  it.effect("refuses a bad signature, a token with no subject, and a malformed token", () =>
    Effect.gen(function* () {
      const keys = yield* AuthJwtTesting.keys;
      const other = yield* AuthJwtTesting.keys;
      const layer = AuthJwt.layer({ issuer, jwks: keys.jwks });
      const forged = yield* other.sign({ iss: issuer, sub: "user_1" });
      expect(yield* Effect.exit(verifyWith(layer, forged))).toEqual(rejected("invalid"));
      const noSubject = yield* keys.sign({ iss: issuer });
      expect(yield* Effect.exit(verifyWith(layer, noSubject))).toEqual(rejected("invalid"));
      expect(yield* Effect.exit(verifyWith(layer, "not.a.jwt"))).toEqual(rejected("invalid"));
    }),
  );

  it.effect("maps scope (space-separated) and scp (array) to scopes", () =>
    Effect.gen(function* () {
      const keys = yield* AuthJwtTesting.keys;
      const layer = AuthJwt.layer({ issuer, jwks: keys.jwks });
      const scope = yield* keys.sign({
        iss: issuer,
        sub: "u",
        scope: " bookings:read  comments:read ",
      });
      expect((yield* verifyWith(layer, scope)).scopes).toEqual(["bookings:read", "comments:read"]);
      const scp = yield* keys.sign({
        iss: issuer,
        sub: "u",
        scp: ["bookings:read", 7, "comments:write"],
      });
      expect((yield* verifyWith(layer, scp)).scopes).toEqual(["bookings:read", "comments:write"]);
    }),
  );

  it.effect("refuses a token with a missing or malformed subject", () =>
    Effect.gen(function* () {
      const keys = yield* AuthJwtTesting.keys;
      const layer = AuthJwt.layer({ issuer, jwks: keys.jwks });
      for (const sub of [7, null, "", ["user_1"], {}]) {
        const token = yield* keys.sign({ iss: issuer, sub });
        expect(yield* Effect.exit(verifyWith(layer, token))).toEqual(rejected("invalid"));
      }
    }),
  );

  it.effect("refuses a token without an expiry", () =>
    Effect.gen(function* () {
      const keys = yield* AuthJwtTesting.keys;
      const layer = AuthJwt.layer({ issuer, jwks: keys.jwks });
      const token = yield* keys.sign({ iss: issuer, sub: "user_1", exp: undefined });
      expect(yield* Effect.exit(verifyWith(layer, token))).toEqual(rejected("invalid"));
    }),
  );

  it.effect("answers unavailable when the key set cannot be fetched", () =>
    Effect.gen(function* () {
      const keys = yield* AuthJwtTesting.keys;
      const token = yield* keys.sign({ iss: issuer, sub: "user_1" });
      const unreachable = AuthJwt.layer({ issuer, jwksUrl: "https://127.0.0.1:1/jwks.json" });
      expect(yield* Effect.exit(verifyWith(unreachable, token))).toEqual(rejected("unavailable"));
    }),
  );

  it.effect("fails to build on a clockTolerance that is not a finite, non-negative number", () =>
    Effect.gen(function* () {
      for (const clockTolerance of [Number.NaN, -1, Number.POSITIVE_INFINITY]) {
        const exit = yield* Effect.exit(Layer.build(AuthJwt.layer({ issuer, clockTolerance })));
        expect(exit).toEqual(
          Exit.fail(
            new AuthJwtConfigInvalid({
              option: "clockTolerance",
              message: "clockTolerance must be a finite, non-negative number of seconds.",
            }),
          ),
        );
      }
      const zero = yield* Effect.exit(Layer.build(AuthJwt.layer({ issuer, clockTolerance: 0 })));
      expect(Exit.isSuccess(zero)).toBe(true);
    }).pipe(Effect.scoped),
  );

  it.effect("fails to build on a JWKS URL that is not https, explicit or from the issuer", () =>
    Effect.gen(function* () {
      const message = "jwksUrl must be an absolute https URL.";
      const failure = Exit.fail(new AuthJwtConfigInvalid({ option: "jwksUrl", message }));
      const explicit = yield* Effect.exit(
        Layer.build(AuthJwt.layer({ issuer, jwksUrl: "http://auth.example.com/jwks.json" })),
      );
      expect(explicit).toEqual(failure);
      const derived = yield* Effect.exit(
        Layer.build(AuthJwt.layer({ issuer: "http://auth.example.com" })),
      );
      expect(derived).toEqual(failure);
      const injected = yield* Effect.exit(
        Layer.build(AuthJwt.layer({ issuer: "http://auth.example.com", jwks: { keys: [] } })),
      );
      expect(Exit.isSuccess(injected)).toBe(true);
    }).pipe(Effect.scoped),
  );

  it.effect("fails to build on an issuer that is not http(s) or a JWKS URL that is not a URL", () =>
    Effect.gen(function* () {
      const badIssuer = yield* Effect.exit(
        Layer.build(AuthJwt.layer({ issuer: "auth.example.com" })),
      );
      expect(badIssuer).toEqual(
        Exit.fail(
          new AuthJwtConfigInvalid({
            option: "issuer",
            message: "issuer must be an absolute http(s) URL.",
          }),
        ),
      );
      const badJwks = yield* Effect.exit(
        Layer.build(AuthJwt.layer({ issuer, jwksUrl: "file:///keys" })),
      );
      expect(Exit.isFailure(badJwks)).toBe(true);
    }).pipe(Effect.scoped),
  );
});

const clerkKey = (prefix: string, host: string) => `${prefix}${Base64.encode(`${host}$`)}`;

describe("AuthJwt.clerk", () => {
  it("derives the issuer from a test or live publishable key", () => {
    expect(AuthJwt.clerkIssuer(clerkKey("pk_test_", "clever-cat-12.clerk.accounts.dev"))).toEqual(
      Option.some("https://clever-cat-12.clerk.accounts.dev"),
    );
    expect(AuthJwt.clerkIssuer(clerkKey("pk_live_", "Clerk.Example.COM"))).toEqual(
      Option.some("https://clerk.example.com"),
    );
    const unpadded = clerkKey("pk_live_", "clerk.ab.com").replace(/=+$/u, "");
    expect(AuthJwt.clerkIssuer(unpadded)).toEqual(Option.some("https://clerk.ab.com"));
  });

  it("refuses a key that is not a Clerk publishable key", () => {
    expect(AuthJwt.clerkIssuer("sk_test_abc")).toEqual(Option.none());
    expect(AuthJwt.clerkIssuer(`pk_test_${Base64.encode("clerk.example.com")}`)).toEqual(
      Option.none(),
    );
    expect(AuthJwt.clerkIssuer("pk_test_!!!")).toEqual(Option.none());
  });

  it.effect("verifies a token issued by the derived Frontend API host", () =>
    Effect.gen(function* () {
      const keys = yield* AuthJwtTesting.keys;
      const host = "clever-cat-12.clerk.accounts.dev";
      const layer = AuthJwt.clerk({ publishableKey: clerkKey("pk_test_", host), jwks: keys.jwks });
      const token = yield* keys.sign({ iss: `https://${host}`, sub: "user_2abc" });
      expect(yield* verifyWith(layer, token)).toMatchObject({
        issuer: `https://${host}`,
        subject: "user_2abc",
      });
      const bad = yield* Effect.exit(Layer.build(AuthJwt.clerk({ publishableKey: "nope" })));
      expect(Exit.isFailure(bad)).toBe(true);
    }).pipe(Effect.scoped),
  );
});
