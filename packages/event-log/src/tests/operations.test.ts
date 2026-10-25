import { expect, expectTypeOf, it } from "@effect/vitest";
import {
  CallRequestId,
  CurrentActor,
  defineFeature,
  defineWay,
  May,
  Mean,
  Runtime,
  runFeature,
  StepTrace,
} from "@house-rules/application";
import { Actor, ActorId, memoryUnitOfWork } from "@house-rules/domain";
import { Effect, Layer, Schema } from "effect";
import { TestClock } from "effect/testing";
import {
  bindEventLog,
  EventLog,
  EventLogMount,
  EventLogOperations,
  EventLogPermissions,
  EventInputInvalid,
} from "../index.js";

expectTypeOf<Parameters<typeof bindEventLog>[0]>().toExtend<EventLog["Service"]>();
expectTypeOf<EventLog["Service"]>().toExtend<Parameters<typeof bindEventLog>[0]>();
const operations = EventLogOperations;
const record = defineFeature("test_recordEvent", {
  ...operations.record,
  permission: null,
  edges: [operations.record],
  handler: (input, { call }) => call(operations.record, input),
});
const system = defineFeature("test_systemRecordEvent", {
  ...operations.record,
  permission: null,
  edges: [operations.record],
  start: { kind: "system", reason: "test fact", startedBy: "test" },
  handler: (input, { call }) => call(operations.record, input),
});
const claim = defineFeature("test_claimEvents", {
  ...operations.claimDue,
  permission: null,
  edges: [operations.claimDue],
  start: { kind: "system", reason: "select events", startedBy: "schedule:event-sweep" },
  handler: (input, { call }) => call(operations.claimDue, input),
});
const handle = defineFeature("test_handleEvent", {
  input: operations.takeNext.input,
  output: Schema.Boolean,
  failure: operations.takeNext.failure,
  description: "App-owned reaction",
  permission: null,
  start: { kind: "system", reason: "react to event", startedBy: "schedule:event-sweep" },
  edges: [operations.takeNext, operations.settleSuccess],
  handler: (input, { call }) =>
    Effect.gen(function* () {
      const delivery = yield* call(operations.takeNext, input);
      return delivery === null ? false : yield* call(operations.settleSuccess, delivery.token);
    }),
});
const failedHandle = defineFeature("test_failedEventHandler", {
  input: operations.takeNext.input,
  output: Schema.Boolean,
  failure: operations.takeNext.failure,
  description: "App reaction that rolls its writes and cursor movement back",
  permission: null,
  start: { kind: "system", reason: "test rollback", startedBy: "schedule:event-sweep" },
  edges: [operations.takeNext, operations.record, operations.settleSuccess],
  handler: (token, { call }) =>
    Effect.gen(function* () {
      const delivery = yield* call(operations.takeNext, token);
      if (delivery === null) return false;
      yield* call(operations.record, delivery.event);
      yield* call(operations.settleSuccess, token);
      return yield* new EventInputInvalid({ message: "Reaction failed." });
    }),
});
const sweep = defineWay({
  protocol: "schedule",
  name: "event-sweep",
  clock: { cron: "* * * * *", timeZone: "UTC" },
  features: [claim, handle],
  mean: Mean.no,
  input: {},
});
const features = [record, system, claim, handle, failedHandle];
const permissions = Object.values(EventLogPermissions);
const module = EventLog.layerMemory({
  registry: { changed: Schema.Struct({ title: Schema.String }) },
  consumers: [{ name: "projection", kinds: ["changed"] }],
});
const world = Runtime.layer({ mounts: [EventLogMount], features, ways: [sweep] }).pipe(
  Layer.provideMerge(module),
  Layer.provideMerge(memoryUnitOfWork),
  Layer.provideMerge(StepTrace.layer()),
);
const actor = Actor.make({ id: ActorId.make("person") });
const caller = Layer.merge(
  Layer.succeed(CurrentActor, actor),
  Layer.succeedContext(
    May.context(May.fixed(permissions), { features, system: permissions, via: "test" }),
  ),
);
const input = {
  kind: "changed",
  subject: { kind: "task", id: "one" },
  scopeId: null,
  payload: { title: "New" },
};
it.layer(world)("EventLog bindings through feature Runtime", (test) => {
  test.effect(
    "mounts every descriptor and stamps only the caller's actor and available request id",
    () =>
      Effect.gen(function* () {
        expect(EventLogMount.service).toBe(EventLog);
        expect(EventLogMount.bind).toBe(bindEventLog);
        expect(EventLogMount.operations).toEqual(Object.values(operations));
        expect(
          yield* runFeature(record, input).pipe(
            Effect.provide(caller),
            Effect.provideService(CallRequestId, "event-request"),
          ),
        ).toMatchObject({ actorId: "person", requestId: "event-request" });
        expect(yield* runFeature(system, input).pipe(Effect.provide(caller))).toMatchObject({
          actorId: null,
        });
        expect(record.transactional).toBe(true);
      }),
  );
  test.effect("commits a selector attempt before running a separate system handler feature", () =>
    Effect.gen(function* () {
      const tokens = yield* runFeature(claim, {}).pipe(Effect.provide(caller));
      expect(tokens).toHaveLength(1);
      const token = tokens[0];
      if (token === undefined) return;
      expect(yield* runFeature(handle, token).pipe(Effect.provide(caller))).toBe(true);
      expect(yield* runFeature(handle, token).pipe(Effect.provide(caller))).toBe(false);
      expect(handle.transactional).toBe(true);
      expect(operations.replay.permission).toBe("event-log:replay");
      expect(operations.replay.needsApproval).toBe(true);
    }),
  );
  test.effect(
    "a failed handler feature rolls back without erasing its committed selector attempt",
    () =>
      Effect.gen(function* () {
        const log = yield* EventLog;
        const before = yield* log.read();
        const [token] = yield* runFeature(claim, {}).pipe(Effect.provide(caller));
        expect(token).toBeDefined();
        if (token === undefined) return;
        expect(
          yield* Effect.flip(runFeature(failedHandle, token).pipe(Effect.provide(caller))),
        ).toBeInstanceOf(EventInputInvalid);
        expect(yield* log.read()).toEqual(before);
        expect(yield* log.due()).toEqual([]);
        yield* TestClock.adjust("1 second");
        const [retry] = yield* runFeature(claim, {}).pipe(Effect.provide(caller));
        expect(retry).toMatchObject({ eventId: token.eventId, attempt: 2 });
      }),
  );
});
