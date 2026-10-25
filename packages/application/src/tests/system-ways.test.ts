import { expect, it } from "@effect/vitest";
import {
  memoryUnitOfWork,
  NoInput,
  NoOpenUnit,
  UnitOfWork,
  errorKind,
  defineOperation,
  Actor,
  ActorId,
} from "@house-rules/domain";
import { Cause, Clock, Context, Deferred, Effect, Layer, Logger, Option, Schema } from "effect";
import { TestClock } from "effect/testing";
import {
  CallWatch,
  CurrentActor,
  composition,
  defineFeature,
  bindOperation,
  defineWay,
  GraphInvalid,
  May,
  Mean,
  appMap,
  StepTrace,
  systemStart,
} from "../index.ts";
class Failed extends Schema.TaggedError<Failed>()("Failed", { kind: errorKind("conflict") }) {}
class Slot extends Context.Service<
  Slot,
  (event: { value: number }) => Effect.Effect<number, string>
>()("test/system/Slot") {}
class Store extends Context.Service<
  Store,
  { readonly write: (n: number) => Effect.Effect<number, Failed | NoOpenUnit> }
>()("test/system/Store") {}
const write = defineOperation("system_write", {
  description: "Write one item.",
  input: Schema.Struct({ value: Schema.Number }),
  output: Schema.Number,
  failure: Failed,
  permission: null,
  transactional: true,
});
const item = defineFeature("system_item", {
  description: "Process one item.",
  input: write.input,
  output: write.output,
  failure: Failed,
  permission: null,
  edges: [write],
  start: systemStart("maintenance"),
  handler: (input, { call }) => call(write, input),
});
const selector = defineFeature("system_selector", {
  description: "Select due items.",
  input: NoInput,
  output: Schema.Array(write.input),
  failure: Schema.Never,
  permission: null,
  flags: { readOnly: true },
  start: systemStart("maintenance"),
  handler: () => Effect.succeed([{ value: 1 }, { value: -1 }, { value: 2 }]),
});
const hook = defineWay({
  protocol: "hook",
  name: "changed",
  slot: Slot,
  features: [item],
  mean: Mean.allow,
  input: (event) => event,
  failure: () => "mapped",
});
const clock = defineWay({
  protocol: "schedule",
  name: "nightly",
  clock: { cron: "0 3 * * *", timeZone: "UTC" },
  features: [selector, item],
  mean: Mean.allow,
  input: {},
});
const setup = (
  ways: readonly (typeof clock | typeof hook)[],
  done: Deferred.Deferred<void>,
  time: Clock.Clock,
  blocked?: Deferred.Deferred<void>,
  stopped?: Deferred.Deferred<Cause.Cause<unknown>>,
  finish?: Deferred.Deferred<void>,
) => {
  const state: number[] = [];
  const actors: boolean[] = [];
  const requests: string[] = [];
  const store = Layer.succeed(Store, {
    write: (n: number) =>
      Effect.gen(function* () {
        yield* UnitOfWork.required;
        actors.push(Option.isSome(yield* Effect.serviceOption(CurrentActor)));
        const prior = [...state];
        yield* UnitOfWork.onRollback(
          Effect.sync(() => {
            state.splice(0, state.length, ...prior);
          }),
        );
        state.push(n);
        if (n === 1 && blocked) {
          yield* Deferred.succeed(blocked, undefined);
          yield* finish ? Deferred.await(finish) : Effect.never;
        }
        if (n < 0) return yield* new Failed();
        if (n === 2) yield* Deferred.succeed(done, undefined);
        return n;
      }),
  });
  // The operation binder keeps expected failure typed rather than hiding it in a service cast.
  const app = composition({
    modules: {
      mounts: [
        {
          service: Store,
          operations: [write],
          layer: store,
          bind: (service: Store["Service"]) => [
            bindOperation(write, ({ value }) => service.write(value)),
          ],
        },
      ],
      layer: Layer.mergeAll(
        StepTrace.layer(),
        memoryUnitOfWork,
        Logger.layer([
          Logger.make(({ message, cause }) => {
            if (stopped && Array.isArray(message) && message[0] === "Schedule nightly stopped")
              Deferred.doneUnsafe(stopped, Effect.succeed(cause));
          }),
        ]),
        Layer.succeed(Clock.Clock, time),
        Layer.succeed(CallWatch, {
          around: (_f, _i, run, facts) => {
            if (facts?.requestId != null) requests.push(facts.requestId);
            return run;
          },
        }),
      ),
    },
    features: [selector, item],
    ways,
    system: [],
    may: Effect.succeed(May.fixed([])),
  });
  return { app, state, actors, requests };
};
it.effect("hook installs a slot, uses fresh system requests and maps failures", () =>
  Effect.gen(function* () {
    const done = yield* Deferred.make<void>();
    const { app, state, actors, requests } = setup([hook], done, yield* Clock.Clock);
    try {
      const context = yield* app.runtime.contextEffect;
      const run = Context.get(context, Slot);
      expect(
        yield* run({ value: 1 }).pipe(
          Effect.provideService(CurrentActor, Actor.make({ id: ActorId.make("ambient") })),
        ),
      ).toBe(1);
      expect(yield* run({ value: 2 })).toBe(2);
      expect(yield* run({ value: -1 }).pipe(Effect.flip)).toBe("mapped");
      expect(state).toEqual([1, 2]);
      expect(actors).toEqual([false, false, false]);
      expect(new Set(requests).size).toBe(3);
      expect((yield* appMap(app)).ways[0]?.slot).toBe("test/system/Slot");
    } finally {
      yield* Effect.promise(() => app.dispose());
    }
    expect((yield* appMap(app).pipe(Effect.flip))._tag).toBe("CompositionClosed");
  }),
);
it.effect("waits until the tick, rolls back failed items and stops on disposal", () =>
  Effect.gen(function* () {
    yield* TestClock.setTime(1767236340000);
    const done = yield* Deferred.make<void>();
    const { app, state } = setup([clock], done, yield* Clock.Clock);
    try {
      yield* app.runtime.contextEffect;
      expect(state).toEqual([]);
      yield* TestClock.adjust("59 seconds");
      expect(state).toEqual([]);
      yield* TestClock.adjust("1 second");
      yield* Deferred.await(done);
      expect(state).toEqual([1, 2]);
      expect((yield* appMap(app)).ways[0]?.clock).toEqual({
        cron: "0 3 * * *",
        timeZone: "UTC",
      });
    } finally {
      yield* Effect.promise(() => app.dispose());
    }
    yield* TestClock.adjust("2 days");
    expect(state).toEqual([1, 2]);
  }),
);
it.effect("impossible calendar crons fail acquisition with typed GraphInvalid", () =>
  Effect.gen(function* () {
    yield* TestClock.setTime(1767236340000);
    for (const cron of ["0 3 30 2 *", "0 3 31 4 *"]) {
      const { app } = setup(
        [{ ...clock, clock: { cron, timeZone: "UTC" } }],
        yield* Deferred.make<void>(),
        yield* Clock.Clock,
      );
      try {
        expect(yield* app.runtime.contextEffect.pipe(Effect.flip)).toBeInstanceOf(GraphInvalid);
      } finally {
        yield* Effect.promise(() => app.dispose());
      }
    }
  }),
);
it.effect("disposal interrupts and rolls back an in-flight schedule item without later work", () =>
  Effect.gen(function* () {
    yield* TestClock.setTime(1767236340000);
    const blocked = yield* Deferred.make<void>();
    const { app, state, requests } = setup(
      [clock],
      yield* Deferred.make<void>(),
      yield* Clock.Clock,
      blocked,
    );
    try {
      yield* app.runtime.contextEffect;
      yield* TestClock.adjust("1 minute");
      yield* Deferred.await(blocked);
      expect(state).toEqual([1]);
    } finally {
      yield* Effect.promise(() => app.dispose());
    }
    expect(state).toEqual([]);
    expect(requests).toHaveLength(2);
    yield* TestClock.adjust("2 days");
    expect(state).toEqual([]);
    expect(requests).toHaveLength(2);
  }),
);
it.effect("a later Cron.next exception stops the driver with GraphInvalid, not a defect", () =>
  Effect.gen(function* () {
    yield* TestClock.setTime(1767236340000);
    const stopped = yield* Deferred.make<Cause.Cause<unknown>>();
    const blocked = yield* Deferred.make<void>();
    const finish = yield* Deferred.make<void>();
    const { app, state } = setup(
      [clock],
      yield* Deferred.make<void>(),
      yield* Clock.Clock,
      blocked,
      stopped,
      finish,
    );
    try {
      yield* app.runtime.contextEffect;
      yield* TestClock.adjust("1 minute");
      yield* Deferred.await(blocked);
      yield* TestClock.setTime(8640000000000000);
      yield* Deferred.succeed(finish, undefined);
      const cause = yield* Deferred.await(stopped);
      expect(Cause.hasDies(cause)).toBe(false);
      expect(Option.getOrUndefined(Cause.findErrorOption(cause))).toBeInstanceOf(GraphInvalid);
      yield* TestClock.adjust("1 second");
      expect(state).toEqual([1, 2]);
    } finally {
      yield* Effect.promise(() => app.dispose());
    }
  }),
);
it("rejects person-start system ways and incompatible selector outputs in types", () => {
  const person = defineFeature("person", {
    description: "Person.",
    permission: null,
    input: NoInput,
    output: Schema.Number,
    failure: Schema.Never,
    handler: () => Effect.succeed(1),
  });
  // @ts-expect-error A hook cannot expose a person-start feature.
  defineWay({ ...hook, features: [person] });
  // @ts-expect-error A selector must return an array of item inputs.
  defineWay({ ...clock, features: [item, item] });
});
it.effect("rejects duplicate hook slots and invalid cron at acquisition", () =>
  Effect.gen(function* () {
    for (const ways of [
      [hook, { ...hook, name: "other" }],
      [{ ...clock, clock: { cron: "broken", timeZone: "UTC" } }],
    ]) {
      const { app } = setup(ways, yield* Deferred.make<void>(), yield* Clock.Clock);
      try {
        expect(yield* app.runtime.contextEffect.pipe(Effect.flip)).toBeInstanceOf(GraphInvalid);
      } finally {
        yield* Effect.promise(() => app.dispose());
      }
    }
  }),
);
