import { expect, it } from "@effect/vitest";
import { CurrentUnit, memoryUnitOfWork, UnitOfWork } from "@house-rules/domain";
import { Deferred, Effect, Layer, Schema } from "effect";
import {
  composition,
  defineFeature,
  defineWay,
  EventInput,
  EventSource,
  May,
  Mean,
  StepTrace,
  systemStart,
} from "../index.ts";
import {
  featureTesting as feature,
  wayTesting as way,
  sourceTesting as source,
  waitTesting as wait,
} from "./event-way-fixtures.ts";

it.effect("failed delivery rolls back before source failure settlement in a separate unit", () =>
  Effect.gen(function* () {
    const settled = yield* Deferred.make<void>();
    const units: unknown[] = [];
    const writes: string[] = [];
    let claimed = false;
    let summary: string | undefined;
    const job = defineFeature("failed_reaction", {
      description: "Fail after a write.",
      input: EventInput,
      output: Schema.Void,
      failure: Schema.Never,
      permission: null,
      start: systemStart("react"),
      flags: { transactional: true },
      handler: () =>
        Effect.gen(function* () {
          units.push(yield* CurrentUnit);
          yield* UnitOfWork.onRollback(
            Effect.sync(() => {
              writes.pop();
            }),
          );
          writes.push("uncommitted");
          return yield* Effect.die("private failure details");
        }),
    });
    const plug: EventSource["Service"] = {
      ...source(["changed"]),
      claimDue: () =>
        Effect.sync(() => {
          if (claimed) return [];
          claimed = true;
          return ["token"];
        }),
      takeNext: () =>
        Effect.succeed({
          id: "1",
          kind: "changed",
          subject: { kind: "task", id: "1" },
          payload: {},
          scopeId: null,
          actorId: null,
          occurredAt: 0,
          requestId: null,
        }),
      settleSuccess: () => Effect.die("Failed work must never settle successfully"),
      settleFailure: (token, safeSummary) =>
        Effect.gen(function* () {
          yield* UnitOfWork.required;
          expect(token).toBe("token");
          expect(writes).toEqual([]);
          units.push(yield* CurrentUnit);
          summary = safeSummary;
          yield* Deferred.succeed(settled, undefined);
          return true;
        }).pipe(Effect.orDie),
    };
    const app = composition({
      modules: {
        mounts: [],
        layer: Layer.mergeAll(
          memoryUnitOfWork,
          StepTrace.layer(),
          Layer.succeed(EventSource, plug),
        ),
      },
      features: [job],
      ways: [
        defineWay({
          protocol: "event",
          name: "react",
          on: ["changed"],
          feature: job,
          mean: Mean.no,
        }),
      ],
      may: Effect.succeed(May.fixed([])),
      system: [],
    });
    yield* Effect.gen(function* () {
      yield* app.runtime.contextEffect;
      yield* wait(Deferred.await(settled));
      expect(summary).toBe("Delivery failed. See internal logs.");
      expect(units).toHaveLength(2);
      expect(units[0]).toBeDefined();
      expect(units[1]).toBeDefined();
      expect(units[1]).not.toBe(units[0]);
    }).pipe(Effect.ensuring(Effect.promise(() => app.dispose())));
  }),
);
it.effect("disposal interrupts a blocked source before its resources close", () =>
  Effect.gen(function* () {
    const entered = yield* Deferred.make<void>();
    const order: string[] = [];
    let running = false;
    const plug = {
      ...source(["changed"]),
      claimDue: () =>
        UnitOfWork.required.pipe(
          Effect.orDie,
          Effect.andThen(
            Effect.sync(() => {
              running = true;
            }),
          ),
          Effect.andThen(Deferred.succeed(entered, undefined)),
          Effect.andThen(Effect.never),
          Effect.onInterrupt(() =>
            Effect.sync(() => {
              running = false;
              order.push("driver stopped");
            }),
          ),
        ),
    };
    const app = composition({
      modules: {
        mounts: [],
        layer: Layer.mergeAll(
          memoryUnitOfWork,
          StepTrace.layer(),
          Layer.effect(
            EventSource,
            Effect.acquireRelease(Effect.succeed(plug), () =>
              Effect.sync(() => {
                order.push(running ? "closed while running" : "source closed");
              }),
            ),
          ),
        ),
      },
      features: [feature],
      ways: [way],
      may: Effect.succeed(May.fixed([])),
      system: [],
    });
    yield* Effect.gen(function* () {
      yield* app.runtime.contextEffect;
      yield* wait(Deferred.await(entered));
    }).pipe(Effect.ensuring(Effect.promise(() => app.dispose())));
    expect(order).toEqual(["driver stopped", "source closed"]);
  }),
);
