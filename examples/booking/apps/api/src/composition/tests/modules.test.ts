import { assert, it } from "@effect/vitest";
import { ConfigProvider, Context, Effect, Layer } from "effect";
import { MyStuff } from "../../read-models/my-bookings/index.ts";
import { Actor, ActorId, UnitOfWork } from "@house-rules/domain";
import { CallWatch, StepTrace, planLayer } from "@house-rules/application";
import { memoryAuditLog } from "@house-rules/call-audit";
import { Features } from "../../features/index.ts";
import { modulePlan } from "../index.ts";

for (const config of [{}, { STORAGE: "memory", DATABASE_URL: "not a database URL" }])
  it.effect(`memory modules ignore DATABASE_URL with config ${JSON.stringify(config)}`, () =>
    Effect.gen(function* () {
      const log = memoryAuditLog();
      const ctx = yield* Layer.build(
        planLayer(modulePlan({ log })).pipe(
          Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(config))),
        ),
      );
      yield* Context.get(ctx, CallWatch).around(Features.makeBooking, {}, Effect.void);
      assert.strictEqual(log.entries().length, 1);
      assert.strictEqual(log.entries()[0]?.target, Features.makeBooking.name);
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
        planLayer(modulePlan()).pipe(
          Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(config))),
        ),
      ).pipe(Effect.flip);
      assert.strictEqual(failure._tag, "ConfigError");
      if (failure._tag === "ConfigError")
        assert.include(failure.message, config.STORAGE === "postgres" ? "DATABASE_URL" : "STORAGE");
    }).pipe(Effect.scoped),
  );
