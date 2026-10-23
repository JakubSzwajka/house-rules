import { assert, it } from "@effect/vitest";
import { Identity } from "@house-rules/identity";
import { planLayer, May, Mean, runFeature } from "@house-rules/application";
import { Actor, UnitOfWork } from "@house-rules/domain";
import { Party } from "@house-rules/party";
import { ConfigProvider, Context, Effect, Layer } from "effect";
import { modulePlan, createApp, Features, systemPermissions } from "../index.ts";
import { grantAdmin } from "../../../scripts/grant-admin.ts";

it.live("sign-up using the former admin email gets only member; shell grant-admin adds admin", () =>
  Effect.gen(function* () {
    const plan = modulePlan();
    const app = yield* Effect.acquireRelease(
      Effect.sync(() =>
        createApp([], {
          modules: {
            ...plan,
            layer: plan.layer.pipe(
              Layer.provideMerge(
                ConfigProvider.layer(
                  ConfigProvider.fromUnknown({ STORAGE: "memory", NODE_ENV: "test" }),
                ),
              ),
            ),
          },
        }),
      ),
      (app) => Effect.promise(() => app.dispose()),
    );
    const ctx = yield* app.runtime.contextEffect;
    const identity = Context.get(ctx, Identity);
    const issuer = yield* identity.passwordIssuer();
    assert.isDefined(issuer);
    const account = yield* UnitOfWork.atomic(
      identity.signUp({
        email: "ADMIN@example.test",
        password: "correct horse battery",
        displayName: "Admin",
      }),
    ).pipe(Effect.provideContext(ctx));
    const id = yield* runFeature(Features.firstSignIn, {
      issuer: issuer.issuer,
      subject: account.accountId,
      displayName: "Admin",
    }).pipe(
      Effect.provideContext(
        Context.merge(
          ctx,
          May.system([Features.firstSignIn], {
            system: systemPermissions,
            via: "hook:new-login",
          }),
        ),
      ),
      Effect.provide(Mean.allow.approval),
    );
    const party = Context.get(ctx, Party);
    const caller = { kind: "person", actor: Actor.make({ id }), via: "test" } as const;
    assert.deepStrictEqual(
      (yield* party.rolesOf(caller, id)).map((role) => role.roleKey),
      ["member"],
    );
    const granted = yield* grantAdmin(" ADMIN@example.test ", {
      nodeEnv: "development",
      yesProduction: false,
    }).pipe(Effect.provideContext(ctx));
    assert.strictEqual(granted, id);
    assert.include(
      (yield* party.rolesOf(caller, id)).map((role) => role.roleKey),
      "admin",
    );
  }).pipe(Effect.scoped),
);

it.live(
  "grant-admin fails clearly for unknown emails and production without explicit approval",
  () =>
    Effect.gen(function* () {
      const ctx = yield* Layer.build(planLayer(modulePlan()));
      const unknown = yield* grantAdmin("unknown@example.test", {
        nodeEnv: "development",
        yesProduction: false,
      }).pipe(Effect.provideContext(ctx), Effect.flip);
      assert.include(unknown.message, "No bound password account");
      const production = yield* grantAdmin("admin@example.test", {
        nodeEnv: "production",
        yesProduction: false,
      }).pipe(Effect.provideContext(ctx), Effect.flip);
      assert.include(production.message, "--yes-production");
    }).pipe(Effect.scoped),
);
