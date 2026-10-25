import { expect, it } from "@effect/vitest";
import { defineFeature, May, Runtime, runFeature, StepTrace } from "@house-rules/application";
import { Actor, ActorId, memoryUnitOfWork, UnitOfWork } from "@house-rules/domain";
import { Effect, Layer, Schema } from "effect";
import { Push, PushMount, PushOperations, PushSendFailed } from "../index.js";

const actor = Actor.make({ id: ActorId.make("runtime-failure-owner") });
const owner = { kind: "person", id: actor.id };
const data = (name: string) => ({
  endpoint: `https://push.example/runtime-${name}`,
  keys: { p256dh: "key", auth: "auth" },
});
const deliver = defineFeature("test_deliver_failure", {
  ...PushOperations.deliver,
  permission: null,
  edges: [PushOperations.deliver],
  start: { kind: "system", reason: "deliver", startedBy: "hook:test" },
  handler: (input, { call }) => call(PushOperations.deliver, input),
});
const recoveredDeliver = defineFeature("test_recovered_deliver", {
  ...PushOperations.deliver,
  permission: null,
  edges: [PushOperations.deliver],
  start: { kind: "system", reason: "deliver", startedBy: "hook:test" },
  handler: (input, { call }) =>
    call(PushOperations.deliver, input).pipe(
      Effect.catchTag("PushSendFailed", (error) =>
        Effect.succeed({ sent: 0, expired: error.events.length, events: error.events }),
      ),
    ),
});
const features = [deliver, recoveredDeliver];
const world = Runtime.layer({ mounts: [PushMount], features, ways: [] }).pipe(
  Layer.provideMerge(
    Push.layerMemoryTesting(
      {},
      {
        results: {
          [data("mixed-gone").endpoint]: "gone",
          [data("mixed-failed").endpoint]: "fail",
        },
      },
    ),
  ),
  Layer.provideMerge(memoryUnitOfWork),
  Layer.provideMerge(StepTrace.layer()),
);
const caller = Layer.succeedContext(
  May.system(features, { system: ["push:deliver"], via: "test" }),
);

it.effect("binding preserves failure facts for same-unit recovery and schema round trips", () =>
  Effect.gen(function* () {
    const push = yield* Push;
    const gone = data("mixed-gone");
    const failed = data("mixed-failed");
    yield* UnitOfWork.atomic(push.subscribe(actor, gone));
    yield* UnitOfWork.atomic(push.subscribe(actor, failed));
    const message = { owner, payload: {}, idempotencyKey: "binding-mixed" };
    const error = yield* Effect.flip(runFeature(deliver, message).pipe(Effect.provide(caller)));
    expect(error).toBeInstanceOf(PushSendFailed);
    if (!Schema.is(PushSendFailed)(error)) return;
    const facts = [{ _tag: "SubscriptionExpired", endpoint: gone.endpoint }];
    expect(error.events).toEqual(facts);
    const encoded = yield* Schema.encodeEffect(PushOperations.deliver.failure)(error);
    const decoded = yield* Schema.decodeEffect(PushOperations.deliver.failure)(encoded);
    expect(decoded).toBeInstanceOf(PushSendFailed);
    expect(decoded).toMatchObject({ events: facts });
    expect(decoded.message).toBe("Push delivery is unavailable. Try again shortly.");
    expect(yield* push.subscriptionsFor(owner)).toHaveLength(2);
    expect(yield* runFeature(recoveredDeliver, message).pipe(Effect.provide(caller))).toEqual({
      sent: 0,
      expired: 1,
      events: facts,
    });
    expect((yield* push.subscriptionsFor(owner)).map((row) => row.endpoint)).toEqual([
      failed.endpoint,
    ]);
    expect(yield* runFeature(recoveredDeliver, message).pipe(Effect.provide(caller))).toEqual({
      sent: 0,
      expired: 0,
      events: [],
    });
  }).pipe(Effect.provide(world)),
);
