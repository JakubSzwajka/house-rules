import { assert, it } from "@effect/vitest";
import { ConfigProvider, Context, Effect, Layer } from "effect";
import { appConfig, modulePlan } from "../app.ts";
import { identityOptions, resourceOf } from "../sign-in.ts";
import { Identity } from "@house-rules/identity";
import { planLayer } from "@house-rules/application";

for (const [config, issuer] of [
  [{ PORT: "3210" }, "http://localhost:3210"],
  [{ APP_ORIGIN: "https://booking.example" }, "https://booking.example"],
  [
    { APP_ORIGIN: "https://booking.example", ACCOUNTS_ISSUER: "https://accounts.example" },
    "https://accounts.example",
  ],
] as const)
  it.effect(`password issuer uses resolved host settings: ${issuer}`, () =>
    Effect.gen(function* () {
      const settings = yield* appConfig;
      const options = yield* identityOptions(settings);
      assert.strictEqual(options.providers[0]?.issuer, issuer);
      assert.deepStrictEqual(
        options.providers.map((provider) => provider.kind),
        ["passwords", "devLocal", "devLocal"],
      );
      // Acquisition must use these resolved values, not read another environment.
      const plan = modulePlan({ settings });
      const context = yield* Layer.build(
        planLayer(plan).pipe(
          Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ NODE_ENV: "test" }))),
        ),
      );
      const signer = yield* Context.get(context, Identity).passwordIssuer();
      assert.strictEqual(signer?.issuer, issuer);
    }).pipe(
      Effect.provide(
        ConfigProvider.layer(ConfigProvider.fromUnknown({ NODE_ENV: "test", ...config })),
      ),
      Effect.scoped,
    ),
  );

it.effect("MCP provider and resource use one configured issuer", () =>
  Effect.gen(function* () {
    const settings = yield* appConfig;
    const options = yield* identityOptions(settings);
    assert.deepStrictEqual(options.providers.at(-1), {
      kind: "oidc",
      issuer: settings.signIn.mcpIssuer,
    });
    const resource = resourceOf(settings.appOrigin, settings.signIn.mcpIssuer);
    assert.isTrue(resource.configured);
    if (resource.configured)
      assert.deepStrictEqual(resource.metadata.authorization_servers, ["https://accounts.example"]);
  }).pipe(
    Effect.provide(
      ConfigProvider.layer(
        ConfigProvider.fromUnknown({
          NODE_ENV: "test",
          APP_ORIGIN: "https://booking.example",
          MCP_AUTH_ISSUER: "https://accounts.example",
        }),
      ),
    ),
  ),
);
