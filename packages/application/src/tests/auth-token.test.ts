import { describe, expect, it } from "@effect/vitest";
import { Effect, Exit, Layer, Option, Schema } from "effect";
import { Authenticator, Principal, TokenRejected, tokenFrom } from "../index.ts";

const incoming = (headers: Record<string, string>) => ({
  headers: new Headers(headers),
  url: "https://app.example/api",
});

describe("tokenFrom", () => {
  it("reads a Bearer token, in any letter case", () => {
    expect(tokenFrom(incoming({ authorization: "Bearer abc.def" }), "bearer")).toEqual(
      Option.some("abc.def"),
    );
    expect(tokenFrom(incoming({ authorization: "bearer abc " }), "bearer")).toEqual(
      Option.some("abc"),
    );
  });

  it("finds no Bearer token in a missing, empty, or other scheme header", () => {
    expect(tokenFrom(incoming({}), "bearer")).toEqual(Option.none());
    expect(tokenFrom(incoming({ authorization: "Bearer " }), "bearer")).toEqual(Option.none());
    expect(tokenFrom(incoming({ authorization: "Basic dXNlcg==" }), "bearer")).toEqual(
      Option.none(),
    );
    expect(tokenFrom(incoming({ authorization: "Bearer a b" }), "bearer")).toEqual(Option.none());
  });

  it("reads a named cookie and ignores the others", () => {
    const request = incoming({ cookie: "theme=dark; __session=tok.en; other=1" });
    expect(tokenFrom(request, { cookie: "__session" })).toEqual(Option.some("tok.en"));
    expect(tokenFrom(request, { cookie: "missing" })).toEqual(Option.none());
    expect(tokenFrom(incoming({}), { cookie: "__session" })).toEqual(Option.none());
    expect(tokenFrom(incoming({ cookie: "__session=" }), { cookie: "__session" })).toEqual(
      Option.none(),
    );
  });

  it("does not read a cookie when the source is bearer", () => {
    expect(tokenFrom(incoming({ cookie: "__session=tok" }), "bearer")).toEqual(Option.none());
  });
});

const principal: Principal = {
  issuer: "https://issuer.example",
  subject: "user_1",
  audience: ["https://app.example/mcp"],
  scopes: ["bookings:read"],
  claims: { sub: "user_1" },
};

const fakeAuthenticator = Layer.succeed(Authenticator, {
  verify: (token, options) =>
    token === "good" &&
    (options?.audience === undefined || principal.audience.includes(options.audience))
      ? Effect.succeed(principal)
      : Effect.fail(new TokenRejected({ reason: token === "good" ? "wrong_audience" : "invalid" })),
});

describe("Authenticator", () => {
  it.effect("is a slot an app fills with any verifier", () =>
    Effect.gen(function* () {
      const authenticator = yield* Authenticator;
      expect(yield* authenticator.verify("good")).toEqual(principal);
      expect(yield* authenticator.verify("good", { audience: "https://app.example/mcp" })).toEqual(
        principal,
      );
      const wrong = yield* Effect.exit(authenticator.verify("good", { audience: "other" }));
      expect(wrong).toEqual(Exit.fail(new TokenRejected({ reason: "wrong_audience" })));
    }).pipe(Effect.provide(fakeAuthenticator)),
  );

  it("decodes a Principal and refuses an unknown reason", () => {
    expect(Schema.decodeSync(Principal)(principal)).toEqual(principal);
    expect(() =>
      Schema.decodeUnknownSync(Principal)({ ...principal, scopes: "bookings:read" }),
    ).toThrow();
    expect(new TokenRejected({ reason: "expired" }).message).toBe("Token rejected: expired");
    expect(() =>
      Schema.decodeUnknownSync(TokenRejected)({ _tag: "TokenRejected", reason: "nope" }),
    ).toThrow();
  });
});
