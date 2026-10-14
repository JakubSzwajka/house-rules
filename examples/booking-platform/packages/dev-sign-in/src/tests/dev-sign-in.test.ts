import { expect, it } from "@effect/vitest";
import { Authenticator } from "@house-rules/application";
import { AuthJwtLocal } from "@house-rules/auth-jwt";
import { Effect, Layer } from "effect";
import { DevSignIn, DevSignInOff, subjectOf } from "../index.js";

const on = DevSignIn.layer.pipe(Layer.provideMerge(AuthJwtLocal.layer()));

it.layer(on)("DevSignIn, switched on", (test) => {
  test.effect("signs a token the local Authenticator accepts, with the name claim", () =>
    Effect.gen(function* acceptedToken() {
      const { token } = yield* (yield* DevSignIn).signIn("Alice Example");
      const principal = yield* (yield* Authenticator).verify(token, {});
      expect(principal.subject).toBe("dev:alice-example");
      expect(principal.claims["name"]).toBe("Alice Example");
    }),
  );

  test.effect("the same name is the same subject, whatever its case or spacing", () =>
    Effect.gen(function* stableSubject() {
      const devSignIn = yield* DevSignIn;
      const authenticator = yield* Authenticator;
      const first = yield* devSignIn.signIn("Alice  Example");
      const again = yield* devSignIn.signIn("alice example");
      const a = yield* authenticator.verify(first.token, {});
      const b = yield* authenticator.verify(again.token, {});
      expect(a.subject).toBe(b.subject);
    }),
  );
});

it.effect("switched off, every sign-in is refused", () =>
  Effect.gen(function* refused() {
    const error = yield* Effect.flip((yield* DevSignIn).signIn("Alice"));
    expect(error).toBeInstanceOf(DevSignInOff);
  }).pipe(Effect.provide(DevSignIn.off)),
);

it("another name is another subject", () => {
  expect(subjectOf("Alice")).not.toBe(subjectOf("Bob"));
  expect(subjectOf(" Bob ")).toBe("dev:bob");
});
