import { describe, expect, it } from "@effect/vitest";
import { Authenticator, TokenRejected } from "@house-rules/application";
import { Effect, Exit, type Layer } from "effect";
import { TestClock } from "effect/testing";
import { decodeJwt } from "jose";
import { AuthJwt, AuthJwtConfigInvalid, AuthJwtLocal, AuthJwtLocalIssuer } from "../index.ts";

const verifyWith = <E>(layer: Layer.Layer<Authenticator, E>, token: string) =>
  Effect.gen(function* () {
    return yield* (yield* Authenticator).verify(token);
  }).pipe(Effect.provide(layer));

const rejected = (reason: TokenRejected["reason"]) => Exit.fail(new TokenRejected({ reason }));

describe("AuthJwtLocal", () => {
  it.effect("an issued token verifies through its layer", () =>
    Effect.gen(function* () {
      const local = yield* AuthJwtLocal.make({ audience: "https://app.example/api" });
      const token = yield* local.issue({ sub: "ada", name: "Ada Lovelace" });
      const principal = yield* verifyWith(local.layer, token);
      expect(principal).toMatchObject({
        issuer: "https://dev-issuer.invalid",
        subject: "ada",
        audience: ["https://app.example/api"],
        claims: { name: "Ada Lovelace" },
      });
      const viaJwks = AuthJwt.layer({ issuer: local.issuer, jwks: local.jwks });
      expect((yield* verifyWith(viaJwks, token)).subject).toBe("ada");
    }),
  );

  it.effect("a token past its time is expired, whatever exp the claims asked for", () =>
    Effect.gen(function* () {
      const local = yield* AuthJwtLocal.make({ ttlSeconds: 60 });
      const token = yield* local.issue({ sub: "ada", exp: 999_999_999 });
      yield* TestClock.adjust("61 seconds");
      expect(yield* Effect.exit(verifyWith(local.layer, token))).toEqual(rejected("expired"));
    }),
  );

  it.effect("reserved claims from the caller never survive", () =>
    Effect.gen(function* () {
      const reserved = { aud: "https://evil.example", nbf: 1, jti: "mine", iss: "https://evil" };
      const open = yield* AuthJwtLocal.make();
      const unbound = decodeJwt(yield* open.issue({ sub: "ada", ...reserved }));
      expect(unbound).not.toHaveProperty("aud");
      expect(unbound).not.toHaveProperty("nbf");
      expect(unbound).not.toHaveProperty("jti");
      expect(unbound.iss).toBe(open.issuer);
      const bound = yield* AuthJwtLocal.make({ audience: "https://app.example/api" });
      const token = yield* bound.issue({ sub: "ada", ...reserved });
      expect(decodeJwt(token).aud).toBe("https://app.example/api");
      expect((yield* verifyWith(bound.layer, token)).audience).toEqual(["https://app.example/api"]);
    }),
  );

  it.effect("a token from another local issuer is refused", () =>
    Effect.gen(function* () {
      const ours = yield* AuthJwtLocal.make();
      const theirs = yield* AuthJwtLocal.make();
      const token = yield* theirs.issue({ sub: "mallory" });
      expect(yield* Effect.exit(verifyWith(ours.layer, token))).toEqual(rejected("invalid"));
      const named = yield* AuthJwtLocal.make({ issuer: "http://localhost:3000" });
      const other = yield* named.issue({ sub: "mallory" });
      expect(yield* Effect.exit(verifyWith(ours.layer, other))).toEqual(rejected("invalid"));
    }),
  );

  it.effect("its layer gives the Authenticator and the issuer from one key pair", () =>
    Effect.gen(function* () {
      const token = yield* (yield* AuthJwtLocalIssuer).issue({ sub: "grace" });
      const principal = yield* (yield* Authenticator).verify(token);
      expect(principal.subject).toBe("grace");
    }).pipe(Effect.provide(AuthJwtLocal.layer())),
  );

  it.effect("a bad issuer or ttl fails with AuthJwtConfigInvalid", () =>
    Effect.gen(function* () {
      const cases = [
        [{ issuer: "dev" }, "issuer"],
        [{ ttlSeconds: 0 }, "ttlSeconds"],
        [{ ttlSeconds: 1.5 }, "ttlSeconds"],
      ] as const;
      for (const [options, option] of cases) {
        const failure = yield* Effect.flip(AuthJwtLocal.make(options));
        expect(failure).toBeInstanceOf(AuthJwtConfigInvalid);
        expect(failure.option).toBe(option);
      }
    }),
  );
});
