import { assert, it } from "@effect/vitest";
import { Authenticator } from "@house-rules/application";
import { ConfigProvider, Effect } from "effect";
import { vi } from "vitest";
import { AuthJwtConfigInvalid, AuthJwtLocal } from "../index.ts";

for (const api of ["make", "layer"] as const) {
  const acquire = () =>
    api === "make"
      ? AuthJwtLocal.make().pipe(Effect.asVoid)
      : Authenticator.pipe(Effect.provide(AuthJwtLocal.layer()), Effect.asVoid);

  it.effect.each(["production", "Production", undefined, "", "   ", "staging"])(
    `${api} refuses non-development NODE_ENV: %s`,
    (environment) =>
      Effect.gen(function* () {
        vi.stubEnv("NODE_ENV", environment);
        try {
          const failure = yield* acquire().pipe(
            Effect.provide(
              ConfigProvider.layer(
                ConfigProvider.fromUnknown(
                  environment === undefined ? {} : { NODE_ENV: environment },
                ),
              ),
            ),
            Effect.flip,
          );
          assert.instanceOf(failure, AuthJwtConfigInvalid);
          assert.strictEqual(failure.option, "NODE_ENV");
          assert.strictEqual(failure.kind, "unavailable");
        } finally {
          vi.unstubAllEnvs();
        }
      }),
  );

  it.effect.each(["development", "test", " DEVELOPMENT ", " TeSt "])(
    `${api} accepts normalized development/test NODE_ENV: %s`,
    (environment) =>
      Effect.gen(function* () {
        vi.stubEnv("NODE_ENV", environment);
        try {
          yield* acquire().pipe(
            Effect.provide(
              ConfigProvider.layer(ConfigProvider.fromUnknown({ NODE_ENV: environment })),
            ),
          );
        } finally {
          vi.unstubAllEnvs();
        }
      }),
  );

  it.effect(`${api} cannot conceal a production host with a test ConfigProvider`, () =>
    Effect.gen(function* () {
      vi.stubEnv("NODE_ENV", "production");
      try {
        const failure = yield* acquire().pipe(
          Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ NODE_ENV: "test" }))),
          Effect.flip,
        );
        assert.strictEqual(failure.option, "NODE_ENV");
      } finally {
        vi.unstubAllEnvs();
      }
    }),
  );
}
