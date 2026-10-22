import { assert, it } from "@effect/vitest";
import { Authenticator } from "@house-rules/application";
import { AuthJwtTesting } from "@house-rules/auth-jwt";
import { ConfigProvider, Effect, Layer } from "effect";
import { ActorId, memoryUnitOfWork, UnitOfWork } from "@house-rules/domain";
import {
  Identity,
  PasswordAccountNotFound,
  PasswordIssuer,
  PasswordsUnavailable,
} from "../index.js";

it.effect("an OIDC-only identity builds and refuses passwords with a typed error", () =>
  Effect.gen(function* () {
    const keys = yield* AuthJwtTesting.keys;
    yield* Effect.gen(function* () {
      const identity = yield* Identity;
      assert.isUndefined(yield* identity.passwordIssuer());
      assert.instanceOf(
        yield* Effect.flip(identity.accountByEmail("a@example.test")),
        PasswordAccountNotFound,
      );
      const failure = yield* Effect.flip(
        identity.signIn({ email: "a@example.test", password: "secret" }),
      );
      assert.instanceOf(failure, PasswordsUnavailable);
      const token = yield* keys.sign({ iss: "https://oidc.example", sub: "alice" });
      assert.strictEqual((yield* (yield* Authenticator).verify(token)).subject, "alice");
    }).pipe(
      Effect.provide(
        Identity.layerMemory({
          providers: [Identity.oidc({ issuer: "https://oidc.example", jwks: keys.jwks })],
        }),
      ),
    );
  }),
);

it.effect("provider routing verifies every issuer with its own keys and audience", () =>
  Effect.gen(function* () {
    const external = yield* AuthJwtTesting.keys;
    const key = yield* PasswordIssuer.newSigningKey;
    yield* Effect.gen(function* () {
      const identity = yield* Identity;
      const local = yield* identity.passwordIssuer();
      assert.isDefined(local);
      const auth = yield* Authenticator;
      const own = yield* local.sign("local-person");
      assert.strictEqual((yield* auth.verify(own.token)).subject, "local-person");
      const token = yield* external.sign({
        iss: "https://oidc.example",
        sub: "external",
        aud: "web",
      });
      assert.strictEqual((yield* auth.verify(token)).subject, "external");
      const alice = ActorId.make("alice");
      const bob = ActorId.make("bob");
      yield* UnitOfWork.atomic(
        Effect.gen(function* () {
          yield* identity.bind({ issuer: local.issuer, subject: "local-person" }, alice);
          yield* identity.bind({ issuer: "https://oidc.example", subject: "external" }, bob);
        }),
      );
      const who = Identity.who({ token: ["bearer", { cookie: "session" }] });
      assert.strictEqual(
        (yield* who.resolve({
          url: "https://app.example",
          headers: new Headers({
            authorization: `Bearer ${own.token}`,
            cookie: `session=${token}`,
          }),
        })).id,
        alice,
      );
      assert.strictEqual(
        (yield* who.resolve({
          url: "https://app.example",
          headers: new Headers({ cookie: `session=${token}` }),
        })).id,
        bob,
      );
      const swapped = yield* external.sign({ iss: local.issuer, sub: "forged" });
      assert.strictEqual((yield* Effect.flip(auth.verify(swapped))).reason, "invalid");
      const wrongAudience = yield* external.sign({
        iss: "https://oidc.example",
        sub: "external",
        aud: "other",
      });
      assert.strictEqual((yield* Effect.flip(auth.verify(wrongAudience))).reason, "wrong_audience");
      const foreign = yield* external.sign({ iss: "https://foreign.example", sub: "external" });
      assert.strictEqual((yield* Effect.flip(auth.verify(foreign))).reason, "wrong_issuer");
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          Identity.refuse,
          memoryUnitOfWork,
          Identity.layerMemory({
            providers: [
              Identity.passwords({ issuer: "https://passwords.example", signingKey: key }),
              Identity.oidc({
                issuer: "https://oidc.example",
                jwks: external.jwks,
                audience: "web",
              }),
            ],
          }),
        ),
      ),
    );
  }),
);

it.effect("ephemeral password signing is refused in production", () =>
  Effect.gen(function* () {
    const failure = yield* Layer.build(
      Identity.layerMemory({
        providers: [Identity.passwords({ issuer: "https://passwords.example", ephemeral: true })],
      }),
    ).pipe(Effect.flip);
    assert.strictEqual(failure._tag, "PasswordIssuerConfigInvalid");
  }).pipe(
    Effect.scoped,
    Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ NODE_ENV: "production" }))),
  ),
);

it.effect("duplicate issuers fail acquisition instead of shadowing a verifier", () =>
  Effect.gen(function* () {
    const keys = yield* AuthJwtTesting.keys;
    const failure = yield* Layer.build(
      Identity.layerMemory({
        providers: [
          Identity.oidc({ issuer: "https://oidc.example", jwks: keys.jwks }),
          Identity.oidc({ issuer: "https://oidc.example", jwks: keys.jwks }),
        ],
      }),
    ).pipe(Effect.flip);
    assert.strictEqual(failure._tag, "AuthJwtConfigInvalid");
  }).pipe(Effect.scoped),
);
