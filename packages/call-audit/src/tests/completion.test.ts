import { expect, it } from "@effect/vitest";
import { Context, Deferred, Effect, Fiber, Layer } from "effect";
import { TestClock } from "effect/testing";
import { AuditStore, CallAudit, memoryAuditStore } from "../index.ts";
import { renameTrip, who } from "./audit-fixtures.ts";

for (const failed of [false, true])
  it.effect(
    `runFeature awaits a delayed audit insert after ${failed ? "failure" : "success"}`,
    () =>
      Effect.gen(function* () {
        const started = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        const store = Context.get(yield* Layer.build(memoryAuditStore()), AuditStore);
        const delayed = Layer.succeed(AuditStore, {
          ...store,
          record: (row) =>
            Deferred.succeed(started, undefined).pipe(
              Effect.andThen(Deferred.await(release)),
              Effect.andThen(store.record(row)),
            ),
        });
        const context = yield* Layer.build(
          CallAudit.layer({ who, policy: CallAudit.presets.strict }).pipe(Layer.provide(delayed)),
        );
        let returned = false;
        const fiber = yield* renameTrip
          .handler({ tripId: failed ? "missing" : "trip", title: "" })
          .pipe(
            Effect.provideContext(context),
            Effect.exit,
            Effect.tap(() =>
              Effect.sync(() => {
                returned = true;
              }),
            ),
            Effect.forkChild,
          );
        yield* Deferred.await(started);
        expect(returned).toBe(false);
        expect(yield* store.read()).toEqual([]);
        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(fiber);
        expect(returned).toBe(true);
        expect((yield* store.read()).map((row) => row.outcome)).toEqual([
          failed ? "TripNotFound" : "success",
        ]);
      }).pipe(Effect.scoped),
  );

it.effect("delayed live-clock retention deletes epoch records but keeps live-clock calls", () =>
  Effect.gen(function* () {
    const started = yield* Deferred.make<void>();
    const release = yield* Deferred.make<void>();
    const finished = yield* Deferred.make<void>();
    const store = Context.get(yield* Layer.build(memoryAuditStore()), AuditStore);
    const delayed = Layer.succeed(AuditStore, {
      ...store,
      deleteExpired: (cutoffs, batchSize) =>
        Deferred.succeed(started, undefined).pipe(
          Effect.andThen(Deferred.await(release)),
          Effect.andThen(store.deleteExpired(cutoffs, batchSize)),
          Effect.tap(() => Deferred.succeed(finished, undefined)),
        ),
    });
    // A composition's ManagedRuntime builds this layer outside the test clock.
    const context = yield* TestClock.withLive(
      Layer.build(
        CallAudit.layer({ who, policy: CallAudit.presets.strict }).pipe(Layer.provide(delayed)),
      ),
    );
    yield* Deferred.await(started);
    const call = renameTrip
      .handler({ tripId: "trip", title: "" })
      .pipe(Effect.provideContext(context));
    yield* call;
    yield* TestClock.withLive(call);
    const before = yield* store.read();
    expect(before).toHaveLength(2);
    expect(before[1]?.recordedAt.getTime()).toBe(0);
    yield* Deferred.succeed(release, undefined);
    yield* Deferred.await(finished);
    expect(yield* store.read()).toEqual([before[0]]);
  }).pipe(Effect.scoped),
);
