import { assert, it } from "@effect/vitest";
import { vi } from "vitest";
import { Authenticator } from "@house-rules/application";
import { AuthJwtTesting } from "@house-rules/auth-jwt";
import { ConfigProvider, Effect, Layer } from "effect";
import { ActorId, memoryUnitOfWork, UnitOfWork } from "@house-rules/domain";
import {
  Identity,
  DevLocalIssuers,
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
          Identity.everyoneActive,
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

it.effect("devLocal exposes signing handles and verifies only its own keys", () =>
  Effect.gen(function* () {
    const issuers = yield* DevLocalIssuers;
    const web = yield* issuers.get("https://web.invalid");
    const partner = yield* issuers.get("https://partner.invalid");
    const auth = yield* Authenticator;
    const token = yield* web.issue({ sub: "alice" });
    assert.strictEqual((yield* auth.verify(token)).subject, "alice");
    const foreign = yield* AuthJwtTesting.keys;
    const swapped = yield* foreign.sign({ iss: web.issuer, sub: "alice" });
    assert.strictEqual((yield* auth.verify(swapped).pipe(Effect.flip)).reason, "invalid");
    const other = yield* partner.issue({ sub: "bob" });
    assert.strictEqual((yield* auth.verify(other)).issuer, partner.issuer);
  }).pipe(
    Effect.provide(
      Identity.layerMemory({
        providers: [
          Identity.devLocal({ issuer: "https://web.invalid" }),
          Identity.devLocal({ issuer: "https://partner.invalid" }),
        ],
      }),
    ),
  ),
);
it.effect("devLocal refuses production with an unavailable provider error", () =>
  Effect.gen(function* () {
    const failure = yield* Layer.build(
      Identity.layerMemory({ providers: [Identity.devLocal({ issuer: "https://dev.invalid" })] }),
    ).pipe(Effect.flip);
    assert.strictEqual(failure._tag, "IdentityProviderInvalid");
    assert.strictEqual(failure.kind, "unavailable");
  }).pipe(
    Effect.scoped,
    Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ NODE_ENV: "production" }))),
  ),
);

for (const [provider, tag] of [
  [Identity.devLocal({ issuer: "https://dev.invalid" }), "IdentityProviderInvalid"],
  [
    Identity.passwords({ issuer: "https://passwords.example", ephemeral: true }),
    "PasswordIssuerConfigInvalid",
  ],
] as const)
  it.effect.each([
    { host: "production", config: { OTHER: "value" } },
    { host: undefined, config: { OTHER: "value" } },
    { host: "production", config: { NODE_ENV: "test" } },
    { host: undefined, config: { NODE_ENV: "" } },
    { host: undefined, config: { NODE_ENV: "   " } },
    { host: "", config: {} },
    { host: "   ", config: {} },
    ...[
      "production",
      "Production",
      "PRODUCTION",
      "pRoDuCtIoN",
      " production ",
      "staging",
      "unknown",
      "",
      "   ",
    ].flatMap((value) => [
      { host: value, config: { NODE_ENV: "test" } },
      { host: undefined, config: { NODE_ENV: value } },
    ]),
  ])(
    `${provider.kind} refuses every NODE_ENV outside development and test %#`,
    ({ host, config }) =>
      Effect.gen(function* () {
        vi.stubEnv("NODE_ENV", host);
        try {
          const failure = yield* Layer.build(Identity.layerMemory({ providers: [provider] })).pipe(
            Effect.flip,
            Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(config))),
          );
          assert.strictEqual(failure._tag, tag);
          assert.strictEqual(failure.kind, "unavailable");
        } finally {
          vi.unstubAllEnvs();
        }
      }).pipe(Effect.scoped),
  );

it.effect.each(["development", "test", " DEVELOPMENT ", " TeSt "])(
  "temporary providers sign only in normalized development/test: %s",
  (environment) =>
    Effect.gen(function* () {
      vi.stubEnv("NODE_ENV", environment);
      try {
        yield* Effect.gen(function* () {
          const local = yield* (yield* DevLocalIssuers).get("https://dev.invalid");
          const token = yield* local.issue({ sub: "probe" });
          assert.strictEqual((yield* (yield* Authenticator).verify(token)).subject, "probe");
          const password = yield* (yield* Identity).passwordIssuer();
          assert.isDefined(password);
          const signed = yield* password.sign("probe");
          assert.strictEqual((yield* (yield* Authenticator).verify(signed.token)).subject, "probe");
        }).pipe(
          Effect.provide(
            Identity.layerMemory({
              providers: [
                Identity.devLocal({ issuer: "https://dev.invalid" }),
                Identity.passwords({ issuer: "https://passwords.invalid", ephemeral: true }),
              ],
            }).pipe(
              Layer.provide(
                ConfigProvider.layer(ConfigProvider.fromUnknown({ NODE_ENV: environment })),
              ),
            ),
          ),
        );
      } finally {
        vi.unstubAllEnvs();
      }
    }),
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
