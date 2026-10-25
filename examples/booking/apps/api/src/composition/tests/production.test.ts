import { assert, it } from "@effect/vitest";
import { Authenticator, May, Mean, runFeature } from "@house-rules/application";
import { IdentityProviderInvalid, PasswordIssuer } from "@house-rules/identity";
import { Context, Effect, Redacted } from "effect";
import { vi } from "vitest";
import { Features } from "../../features/index.ts";
import { systemPermissions } from "../access.ts";
import { createApp } from "../app.ts";
import { identityOptions, testIssuers } from "../sign-in.ts";

const settings = (nodeEnv: string, signingKey = Redacted.make("")) => ({
  nodeEnv,
  port: 3000,
  appOrigin: "https://booking.example",
  signIn: { issuer: "", signingKey, mcpIssuer: "" },
});

it.live(
  "production starts with a stable key, signs up and in, and rejects the devLocal issuer",
  () =>
    Effect.gen(function* () {
      const development = yield* Effect.acquireRelease(
        Effect.sync(() => createApp([], { settings: settings("test") })),
        (app) => Effect.promise(() => app.dispose()),
      );
      const context = yield* development.runtime.contextEffect;
      const handles = yield* testIssuers.pipe(Effect.provideContext(context));
      const devToken = yield* handles.web.issue({ sub: "development-only" });
      const signingKey = yield* PasswordIssuer.newSigningKey;
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("STORAGE", "memory");
      try {
        const production = settings("production", signingKey);
        const options = yield* identityOptions(production);
        assert.deepStrictEqual(
          options.providers.map((provider) => provider.kind),
          ["passwords"],
        );
        const withMcp = yield* identityOptions({
          ...production,
          signIn: { ...production.signIn, mcpIssuer: "https://mcp.example" },
        });
        assert.deepStrictEqual(
          withMcp.providers.map((provider) => provider.kind),
          ["passwords", "oidc"],
        );
        const app = yield* Effect.acquireRelease(
          Effect.sync(() => createApp([], { settings: production })),
          (app) => Effect.promise(() => app.dispose()),
        );
        const productionContext = yield* app.runtime.contextEffect;
        const missing = yield* testIssuers.pipe(
          Effect.provideContext(productionContext),
          Effect.flip,
        );
        assert.instanceOf(missing, IdentityProviderInvalid);
        const requestContext = Context.merge(
          productionContext,
          May.system(Object.values(Features), {
            system: systemPermissions,
            via: "production-test",
          }),
        );
        const credentials = { email: "production@example.test", password: "correct horse battery" };
        const up = yield* runFeature(Features.signUp, {
          ...credentials,
          displayName: "Production",
        }).pipe(Effect.provideContext(requestContext), Effect.provide(Mean.allow.approval));
        const signed = yield* runFeature(Features.signIn, credentials).pipe(
          Effect.provideContext(requestContext),
          Effect.provide(Mean.allow.approval),
        );
        assert.property(signed, "token");
        if (!("token" in signed)) return;
        const auth = Context.get(productionContext, Authenticator);
        assert.strictEqual((yield* auth.verify(signed.token)).subject, up.accountId);
        assert.strictEqual((yield* auth.verify(devToken).pipe(Effect.flip)).reason, "wrong_issuer");
      } finally {
        vi.unstubAllEnvs();
      }
    }).pipe(Effect.scoped),
);

it.live(
  "production without ACCOUNTS_SIGNING_KEY refuses startup with IdentityProviderInvalid",
  () =>
    Effect.gen(function* () {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("STORAGE", "memory");
      try {
        const app = yield* Effect.acquireRelease(
          Effect.sync(() => createApp([], { settings: settings("production") })),
          (app) => Effect.promise(() => app.dispose()),
        );
        const failure = yield* app.runtime.contextEffect.pipe(Effect.flip);
        assert.instanceOf(failure, IdentityProviderInvalid);
        assert.strictEqual(failure.option, "signingKey");
        assert.strictEqual(failure.message, "ACCOUNTS_SIGNING_KEY is required in production.");
      } finally {
        vi.unstubAllEnvs();
      }
    }).pipe(Effect.scoped),
);
