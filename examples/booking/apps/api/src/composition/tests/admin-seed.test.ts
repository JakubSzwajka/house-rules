import { assert, it } from "@effect/vitest";
import { Identity, PasswordIssuer } from "@house-rules/identity";
import { Actor, UnitOfWork } from "@house-rules/domain";
import { FirstSignIn } from "@house-rules/identity";
import { Party } from "@house-rules/party";
import { ConfigProvider, Context, Effect, Layer, Redacted } from "effect";
import { modulesLayer, plugSockets } from "../index.ts";

it.live(
  "development admin seed requires the accounts issuer and exact email, and keeps member",
  () =>
    Effect.gen(function* () {
      const modules = modulesLayer().pipe(
        Layer.provide(
          ConfigProvider.layer(
            ConfigProvider.fromUnknown({
              STORAGE: "memory",
              DEMO_ADMIN_EMAIL: "admin@example.test",
            }),
          ),
        ),
      );
      const ctx = yield* Layer.build(
        plugSockets(modules).pipe(
          Layer.provide(
            ConfigProvider.layer(
              ConfigProvider.fromUnknown({ DEMO_ADMIN_EMAIL: "admin@example.test" }),
            ),
          ),
        ),
      );
      const accounts = Context.get(ctx, Identity);
      const issuer = yield* accounts.passwordIssuer();
      assert.isDefined(issuer);
      const hook = Context.get(ctx, FirstSignIn);
      const party = Context.get(ctx, Party);
      const account = yield* UnitOfWork.atomic(
        accounts.signUp({
          email: "admin@example.test",
          password: "correct horse battery",
          displayName: "Admin",
        }),
      ).pipe(Effect.provideContext(ctx));
      for (const [iss, subject, email, admin] of [
        [issuer.issuer, account.accountId, "admin@example.test", true],
        [issuer.issuer, "other", "other@example.test", false],
        ["https://foreign.invalid", "foreign", "admin@example.test", false],
      ] as const) {
        const id = yield* hook({
          issuer: iss,
          subject,
          audience: [],
          scopes: [],
          claims: { email },
        });
        const permissions = yield* party.permissionsOf({
          kind: "person",
          actor: Actor.make({ id }),
          via: "test",
        });
        assert.strictEqual(permissions.includes("party:admin"), admin);
        assert.include(permissions, "bookings:read");
      }
    }).pipe(Effect.scoped),
);

it.live("production refuses DEMO_ADMIN_EMAIL even with a signing key", () =>
  Effect.gen(function* () {
    const key = yield* PasswordIssuer.newSigningKey;
    const modules = modulesLayer().pipe(
      Layer.provide(
        ConfigProvider.layer(
          ConfigProvider.fromUnknown({
            STORAGE: "memory",
            NODE_ENV: "production",
            DEMO_ADMIN_EMAIL: "admin@example.test",
            ACCOUNTS_SIGNING_KEY: Redacted.value(key),
          }),
        ),
      ),
    );
    const error = yield* Layer.build(modules).pipe(Effect.flip);
    assert.strictEqual(error._tag, "DemoForbidden");
  }).pipe(Effect.scoped),
);
