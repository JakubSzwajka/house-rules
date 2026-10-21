import { assert, it } from "@effect/vitest";
import { ConfigProvider, Context, Effect, Layer } from "effect";
import { MyStuff } from "../../read-models/my-bookings/index.ts";
import { Actor, ActorId, UnitOfWork } from "@house-rules/domain";
import { StepTrace } from "@house-rules/application";
import { memoryAuditLog } from "@house-rules/call-audit";
import { AuditStorage } from "../audit-storage.ts";
import { modulesLayer } from "../index.ts";

for (const config of [{}, { STORAGE: "memory", DATABASE_URL: "not a database URL" }])
  it.effect(`memory modules ignore DATABASE_URL with config ${JSON.stringify(config)}`, () =>
    Effect.gen(function* () {
      const log = memoryAuditLog();
      const ctx = yield* Layer.build(
        modulesLayer({ log }).pipe(
          Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(config))),
        ),
      );
      const storage = Context.get(ctx, AuditStorage);
      assert.strictEqual(storage.kind, "memory");
      if (storage.kind === "memory") assert.strictEqual(storage.log, log);
      assert.isDefined(Context.get(ctx, UnitOfWork));
      assert.isDefined(Context.get(ctx, StepTrace));
      const failure = yield* Context.get(ctx, MyStuff)
        .myBookings(Actor.make({ id: ActorId.make("alice") }))
        .pipe(Effect.flip);
      assert.strictEqual(failure._tag, "ReadUnavailable");
    }).pipe(Effect.scoped),
  );

for (const config of [
  { STORAGE: "postgres" },
  { STORAGE: "postgres", DATABASE_URL: "" },
  { STORAGE: "unknown" },
])
  it.effect(`invalid storage config fails closed: ${JSON.stringify(config)}`, () =>
    Effect.gen(function* () {
      const failure = yield* Layer.build(
        modulesLayer().pipe(
          Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(config))),
        ),
      ).pipe(Effect.flip);
      assert.strictEqual(failure._tag, "ConfigError");
      if (failure._tag === "ConfigError")
        assert.include(failure.message, config.STORAGE === "postgres" ? "DATABASE_URL" : "STORAGE");
    }).pipe(Effect.scoped),
  );
