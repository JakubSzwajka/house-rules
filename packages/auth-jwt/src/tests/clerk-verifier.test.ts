import { describe, expect, it } from "@effect/vitest";
import { Authenticator, TokenRejected } from "@house-rules/application";
import { Effect, Exit } from "effect";
import { Base64, Base64Url } from "effect/encoding";
import { TestClock } from "effect/testing";
import { AuthJwt, AuthJwtConfigInvalid, AuthJwtTesting, type ClerkOptions } from "../index.ts";

const issuer = "https://clerk.example.com";
const origin = "https://app.example.com";
const publishableKey = `pk_live_${Base64.encode("clerk.example.com$")}`;
const clerk: ClerkOptions = { publishableKey, authorizedParties: [origin] };
const invalid = Exit.fail(new TokenRejected({ reason: "invalid" }));

const kinds = [
  { typ: undefined, claims: { sub: "user_1", sid: "sess_1" }, kind: "session" },
  { typ: "JWT", claims: { sub: "user_1", sid: "sess_1" }, kind: "session" },
  { typ: "at+jwt", claims: { sub: "user_1", sid: "sess_1" }, kind: "oauth_access" },
  { typ: "application/at+jwt", claims: { sub: "user_1", sid: "sess_1" }, kind: "oauth_access" },
  { typ: "at+jwt", claims: { sub: "mch_1" }, kind: "oauth_access" },
  { typ: "application/at+jwt", claims: { sub: "mch_1" }, kind: "oauth_access" },
  { typ: undefined, claims: { sub: "mch_1" }, kind: "machine" },
  { typ: "other", claims: { sub: "mch_1", sid: "sess_1" }, kind: "machine" },
  { typ: "other", claims: { sub: "user_1", sid: "sess_1" }, kind: "unknown" },
  { typ: "jwt", claims: { sub: "user_1", sid: "sess_1" }, kind: "unknown" },
  { typ: "JWT", claims: { sub: "org_1", sid: "sess_1" }, kind: "unknown" },
  { typ: "JWT", claims: { sub: "not_user_1", sid: "sess_1" }, kind: "unknown" },
  { typ: "JWT", claims: { sub: "user_1" }, kind: "unknown" },
  { typ: "JWT", claims: { sub: "user_1", sid: "" }, kind: "unknown" },
  { typ: "JWT", claims: { sub: "user_1", sid: 7 }, kind: "unknown" },
  { typ: "JWT", claims: { sub: "user_1", sid: null }, kind: "unknown" },
  { typ: "JWT", claims: { sub: "user_1", sid: "sess_1", act: { sub: "user_2" } }, kind: "unknown" },
  { typ: "JWT", claims: { sub: "user_1", sid: "sess_1", act: null }, kind: "unknown" },
  { typ: "JWT", claims: { sub: "user_1", sid: "sess_1", act: false }, kind: "unknown" },
] as const;

describe("AuthJwt.verifier and clerkKind", () => {
  it.effect.each(kinds)("classifies verified token %# as $kind", ({ typ, claims, kind }) =>
    Effect.gen(function* () {
      const keys = yield* AuthJwtTesting.keys;
      const options = yield* AuthJwt.clerkOptions({ ...clerk, jwks: keys.jwks });
      const verifier = yield* AuthJwt.verifier(options);
      const token = yield* keys.sign({ iss: issuer, ...claims }, typ === undefined ? {} : { typ });
      const verified = yield* verifier.verify(token);
      expect(verified.header).toEqual({
        alg: "ES256",
        kid: "house-rules-test",
        ...(typ === undefined ? {} : { typ }),
      });
      expect(verified.principal.claims).toMatchObject(claims);
      expect(AuthJwt.clerkKind(verified.header, verified.principal.claims)).toBe(kind);
    }),
  );

  it("returns unknown for malformed classifier inputs without throwing", () => {
    for (const sub of [undefined, null, 42, {}, ["user_1"]]) {
      expect(AuthJwt.clerkKind({ typ: "JWT" }, { sub, sid: "sess_1" })).toBe("unknown");
    }
    expect(AuthJwt.clerkKind({ typ: null }, { sub: "user_1", sid: "sess_1" })).toBe("unknown");
    expect(AuthJwt.clerkKind({}, { sub: "user_1", sid: "sess_1", act: undefined })).toBe("unknown");
    expect(AuthJwt.clerkKind({ typ: "at+jwt" }, {})).toBe("oauth_access");
  });

  it.effect("returns no header for a bad signature or a tampered protected header", () =>
    Effect.gen(function* () {
      const keys = yield* AuthJwtTesting.keys;
      const other = yield* AuthJwtTesting.keys;
      const verifier = yield* AuthJwt.verifier({ issuer, jwks: keys.jwks });
      const forged = yield* other.sign(
        { iss: issuer, sub: "user_1", sid: "sess_1" },
        { typ: "JWT" },
      );
      let returned = false;
      const observe = (token: string) =>
        verifier.verify(token).pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              returned = true;
            }),
          ),
        );
      expect(yield* Effect.exit(observe(forged))).toEqual(invalid);
      const signed = yield* keys.sign(
        { iss: issuer, sub: "user_1", sid: "sess_1" },
        { typ: "at+jwt" },
      );
      const parts = signed.split(".");
      const tampered = [
        Base64Url.encode(JSON.stringify({ alg: "ES256", kid: "house-rules-test", typ: "JWT" })),
        ...parts.slice(1),
      ].join(".");
      expect(yield* Effect.exit(observe(tampered))).toEqual(invalid);
      expect(yield* Effect.exit(observe("not.a.jwt"))).toEqual(invalid);
      expect(returned).toBe(false);
    }),
  );

  it.effect("keeps issuer, subject, expiry, not-before and audience checks on the verifier", () =>
    Effect.gen(function* () {
      const keys = yield* AuthJwtTesting.keys;
      const verifier = yield* AuthJwt.verifier({ issuer, jwks: keys.jwks, audience: "resource" });
      for (const [claims, reason] of [
        [{ iss: "https://other.example" }, "wrong_issuer"],
        [{ sub: "" }, "invalid"],
        [{ sub: undefined }, "invalid"],
        [{ exp: undefined }, "invalid"],
        [{ exp: -1 }, "expired"],
        [{ nbf: 100 }, "invalid"],
        [{ aud: "other" }, "wrong_audience"],
      ] as const) {
        const token = yield* keys.sign({ iss: issuer, sub: "user_1", aud: "resource", ...claims });
        expect(yield* Effect.exit(verifier.verify(token))).toEqual(
          Exit.fail(new TokenRejected({ reason })),
        );
      }
      const token = yield* keys.sign({ iss: issuer, sub: "user_1", aud: "override" });
      expect((yield* verifier.verify(token, { audience: "override" })).principal.subject).toBe(
        "user_1",
      );
    }),
  );
});

describe("authorizedParties", () => {
  it.effect(
    "allows matching or absent azp, rejects other present values, and is opt-in for generic JWT",
    () =>
      Effect.gen(function* () {
        const keys = yield* AuthJwtTesting.keys;
        const guarded = yield* AuthJwt.verifier({
          issuer,
          jwks: keys.jwks,
          authorizedParties: [origin, "https://second.example"],
        });
        const generic = yield* AuthJwt.verifier({ issuer, jwks: keys.jwks });
        for (const azp of [origin, "https://second.example", undefined]) {
          const token = yield* keys.sign({ iss: issuer, sub: "user_1", azp });
          expect((yield* guarded.verify(token)).principal.subject).toBe("user_1");
        }
        for (const azp of [
          "https://evil.example",
          `${origin}/`,
          "",
          null,
          42,
          [origin],
          { origin },
        ]) {
          const token = yield* keys.sign({ iss: issuer, sub: "user_1", azp });
          expect(yield* Effect.exit(guarded.verify(token))).toEqual(invalid);
          expect((yield* generic.verify(token)).principal.subject).toBe("user_1");
        }
        const token = yield* keys.sign({ iss: issuer, sub: "user_1", azp: origin });
        const empty = yield* AuthJwt.verifier({ issuer, jwks: keys.jwks, authorizedParties: [] });
        expect(yield* Effect.exit(empty.verify(token))).toEqual(invalid);
      }),
  );

  it.effect("applies Clerk azp and pending checks through the existing Principal-only layer", () =>
    Effect.gen(function* () {
      const keys = yield* AuthJwtTesting.keys;
      const layer = AuthJwt.clerk({ ...clerk, jwks: keys.jwks, rejectPending: true });
      const check = (token: string) =>
        Effect.flatMap(Authenticator, (auth) => auth.verify(token)).pipe(Effect.provide(layer));
      const good = yield* keys.sign({ iss: issuer, sub: "user_1", azp: origin, sts: "active" });
      const principal = yield* check(good);
      expect(principal.subject).toBe("user_1");
      expect(principal).not.toHaveProperty("header");
      const wrong = yield* keys.sign({ iss: issuer, sub: "user_1", azp: "https://evil.example" });
      expect(yield* Effect.exit(check(wrong))).toEqual(invalid);
      const pending = yield* keys.sign({ iss: issuer, sub: "user_1", azp: origin, sts: "pending" });
      expect(yield* Effect.exit(check(pending))).toEqual(invalid);
      const verifier = yield* AuthJwt.verifier(
        yield* AuthJwt.clerkOptions({ ...clerk, jwks: keys.jwks }),
      );
      expect((yield* verifier.verify(pending)).principal.subject).toBe("user_1");
    }),
  );
});

describe("AuthJwt.clerkOptions", () => {
  it.effect(
    "derives issuer, JWKS URL and five-second tolerance and preserves explicit options",
    () =>
      Effect.gen(function* () {
        expect(yield* AuthJwt.clerkOptions(clerk)).toEqual({
          issuer,
          jwksUrl: `${issuer}/.well-known/jwks.json`,
          authorizedParties: [origin],
          clockTolerance: 5,
        });
        const keys = yield* AuthJwtTesting.keys;
        expect(
          yield* AuthJwt.clerkOptions({
            ...clerk,
            jwks: keys.jwks,
            clockTolerance: 0,
            audience: "resource",
            rejectPending: true,
          }),
        ).toEqual({
          issuer,
          jwksUrl: `${issuer}/.well-known/jwks.json`,
          authorizedParties: [origin],
          clockTolerance: 0,
          audience: "resource",
          rejectPending: true,
          jwks: keys.jwks,
        });
        for (const authorizedParties of [[], [""], ["  "]]) {
          expect(yield* Effect.exit(AuthJwt.clerkOptions({ ...clerk, authorizedParties }))).toEqual(
            Exit.fail(
              new AuthJwtConfigInvalid({
                option: "authorizedParties",
                message: "authorizedParties must be a nonempty list of nonempty strings.",
              }),
            ),
          );
        }
        for (const clockTolerance of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
          expect(
            (yield* AuthJwt.clerkOptions({ ...clerk, clockTolerance }).pipe(Effect.flip)).option,
          ).toBe("clockTolerance");
        }
      }),
  );

  it.effect("uses five seconds for expiry and nbf, while generic JWT remains strict", () =>
    Effect.gen(function* () {
      const keys = yield* AuthJwtTesting.keys;
      const verifier = yield* AuthJwt.verifier(
        yield* AuthJwt.clerkOptions({ ...clerk, jwks: keys.jwks }),
      );
      const strict = yield* AuthJwt.verifier({ issuer, jwks: keys.jwks });
      const explicitZero = yield* AuthJwt.verifier(
        yield* AuthJwt.clerkOptions({ ...clerk, jwks: keys.jwks, clockTolerance: 0 }),
      );
      const future = yield* keys.sign({ iss: issuer, sub: "user_1", nbf: 4 });
      expect((yield* verifier.verify(future)).principal.subject).toBe("user_1");
      expect(yield* Effect.exit(strict.verify(future))).toEqual(invalid);
      expect(yield* Effect.exit(explicitZero.verify(future))).toEqual(invalid);
      const farFuture = yield* keys.sign({ iss: issuer, sub: "user_1", nbf: 6 });
      expect(yield* Effect.exit(verifier.verify(farFuture))).toEqual(invalid);
      const token = yield* keys.sign({ iss: issuer, sub: "user_1" });
      yield* TestClock.adjust("604 seconds");
      expect((yield* verifier.verify(token)).principal.subject).toBe("user_1");
      expect(yield* Effect.exit(strict.verify(token))).toEqual(
        Exit.fail(new TokenRejected({ reason: "expired" })),
      );
      yield* TestClock.adjust("1 second");
      expect(yield* Effect.exit(verifier.verify(token))).toEqual(
        Exit.fail(new TokenRejected({ reason: "expired" })),
      );
    }),
  );
});
