import { expect, it } from "@effect/vitest";
import { CurrentUnit, memoryUnitOfWork, UnitOfWork } from "@house-rules/domain";
import { Clock, Deferred, Effect, Layer, Queue, Schema, Stream } from "effect";
import { TestClock } from "effect/testing";
import {
  composition,
  defineFeature,
  defineWay,
  EventInput,
  EventSource,
  GraphInvalid,
  May,
  Mean,
  runFeature,
  StepTrace,
  systemStart,
} from "../index.ts";

import {
  featureTesting as feature,
  wayTesting as way,
  sourceTesting as source,
  appForTesting as appFor,
  waitTesting as wait,
} from "./event-way-fixtures.ts";
it.effect(
  "event acquisition rejects missing source, mismatched kinds and duplicate consumers",
  () =>
    Effect.gen(function* () {
      for (const [ways, plug, reason] of [
        [[way], null, "Missing EventSource"],
        [[way], source([]), "missing [changed], extra []"],
        [[way], source(["changed", "extra"]), "missing [], extra [extra]"],
        [[way, way], source(["changed"]), "Duplicate way name"],
      ] as const) {
        const app = appFor([...ways], plug);
        yield* Effect.gen(function* () {
          const error = yield* Effect.flip(app.runtime.contextEffect);
          expect(error).toBeInstanceOf(GraphInvalid);
          expect((error as GraphInvalid).reason).toContain(reason);
        }).pipe(Effect.ensuring(Effect.promise(() => app.dispose())));
      }
    }),
);
it.effect("event acquisition rejects a forged person-start way before starting delivery", () =>
  Effect.gen(function* () {
    const person = defineFeature("person", {
      description: "Person.",
      input: EventInput,
      output: Schema.Void,
      failure: Schema.Never,
      permission: null,
      handler: () => Effect.void,
    });
    const invalid = defineWay({
      // @ts-expect-error Event ways require a system feature at the type boundary too.
      protocol: "event",
      name: "react",
      on: ["changed"],
      feature: person,
      mean: Mean.no,
    });
    const app = composition({
      modules: {
        mounts: [],
        layer: Layer.mergeAll(
          memoryUnitOfWork,
          StepTrace.layer(),
          Layer.succeed(EventSource, source(["changed"])),
        ),
      },
      features: [person],
      ways: [invalid],
      may: Effect.succeed(May.fixed([])),
      system: [],
    });
    yield* Effect.gen(function* () {
      expect(yield* Effect.flip(app.runtime.contextEffect)).toBeInstanceOf(GraphInvalid);
    }).pipe(Effect.ensuring(Effect.promise(() => app.dispose())));
  }),
);
it.effect("event ways refuse features whose input cannot accept EventInput", () =>
  Effect.sync(() => {
    const unrelated = defineFeature("unrelated", {
      description: "Not an event handler.",
      input: Schema.Struct({ taskId: Schema.String }),
      output: Schema.Void,
      failure: Schema.Never,
      permission: null,
      start: systemStart("unrelated"),
      handler: () => Effect.void,
    });
    defineWay({
      // @ts-expect-error An event way passes EventInput, never { taskId }.
      protocol: "event",
      name: "unrelated",
      on: ["changed"],
      feature: unrelated,
      mean: Mean.no,
    });
  }),
);
it.effect("an app with no event ways needs no EventSource or event-log", () =>
  Effect.gen(function* () {
    const app = composition({
      modules: { mounts: [], layer: StepTrace.layer() },
      features: [feature],
      ways: [],
      may: Effect.succeed(May.fixed([])),
      system: [],
    });
    yield* Effect.gen(function* () {
      const context = yield* app.runtime.contextEffect;
      yield* runFeature(feature, {
        event: {
          id: "1",
          kind: "changed",
          subject: { kind: "task", id: "1" },
          payload: {},
          scopeId: null,
          actorId: null,
          occurredAt: 0,
          requestId: null,
        },
        causedBy: null,
      }).pipe(
        Effect.provideContext(context),
        Effect.provideContext(May.system([feature], { system: [], via: "test" })),
      );
    }).pipe(Effect.ensuring(Effect.promise(() => app.dispose())));
  }),
);
it.effect("source wakes and the configured sweep both drain deliveries", () =>
  Effect.gen(function* () {
    const wake = yield* Queue.unbounded<void>();
    const started = yield* Deferred.make<void>();
    const first = yield* Deferred.make<void>();
    const second = yield* Deferred.make<void>();
    let due = false;
    let delivered = 0;
    const plug: EventSource["Service"] = {
      ...source(["changed"]),
      wake: Stream.fromQueue(wake),
      claimDue: () =>
        Effect.gen(function* () {
          yield* Deferred.succeed(started, undefined);
          if (!due) return [];
          due = false;
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
      settleSuccess: () =>
        Effect.gen(function* () {
          delivered++;
          yield* Deferred.succeed(delivered === 1 ? first : second, undefined);
          return true;
        }),
    };
    const app = composition({
      modules: {
        mounts: [],
        layer: Layer.mergeAll(
          memoryUnitOfWork,
          StepTrace.layer(),
          Layer.succeed(EventSource, plug),
          Layer.succeed(Clock.Clock, yield* Clock.Clock),
        ),
      },
      features: [feature],
      ways: [way],
      may: Effect.succeed(May.fixed([])),
      system: [],
      eventSweepMs: 1000,
    });
    yield* Effect.gen(function* () {
      yield* app.runtime.contextEffect;
      yield* wait(Deferred.await(started));
      expect(delivered).toBe(0);
      due = true;
      yield* Queue.offer(wake, undefined);
      yield* wait(Deferred.await(first));
      due = true;
      yield* wait(TestClock.adjust(1000));
      yield* wait(Deferred.await(second));
      expect(delivered).toBe(2);
    }).pipe(Effect.ensuring(Effect.promise(() => app.dispose())));
  }),
);
it.effect("claim commits first; take, feature and success share one distinct unit", () =>
  Effect.gen(function* () {
    const settled = yield* Deferred.make<void>();
    const units: Array<unknown> = [];
    let claimed = false;
    const event = {
      id: "1",
      kind: "changed",
      subject: { kind: "task", id: "1" },
      payload: {},
      scopeId: null,
      actorId: null,
      occurredAt: 0,
      requestId: null,
    };
    const job = defineFeature("unit_reaction", {
      description: "Inspect delivery unit.",
      input: EventInput,
      output: Schema.Void,
      failure: Schema.Never,
      permission: null,
      start: systemStart("react"),
      flags: { transactional: true },
      handler: (input) =>
        Effect.gen(function* () {
          yield* UnitOfWork.required;
          units.push(yield* CurrentUnit);
          expect(input.causedBy).toBeNull();
        }),
    });
    const plug: EventSource["Service"] = {
      ...source(["changed"]),
      claimDue: () =>
        Effect.gen(function* () {
          yield* UnitOfWork.required;
          if (claimed) return [];
          claimed = true;
          units.push(yield* CurrentUnit);
          yield* UnitOfWork.onRollback(Effect.die("The claim must commit before delivery"));
          return ["token"];
        }).pipe(Effect.orDie),
      takeNext: () =>
        Effect.gen(function* () {
          yield* UnitOfWork.required;
          units.push(yield* CurrentUnit);
          return event;
        }).pipe(Effect.orDie),
      settleSuccess: () =>
        Effect.gen(function* () {
          yield* UnitOfWork.required;
          units.push(yield* CurrentUnit);
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
      expect(units).toHaveLength(4);
      expect(units[0]).toBeDefined();
      expect(units[1]).not.toBe(units[0]);
      expect(units[2]).toBe(units[1]);
      expect(units[3]).toBe(units[1]);
    }).pipe(Effect.ensuring(Effect.promise(() => app.dispose())));
  }),
);
