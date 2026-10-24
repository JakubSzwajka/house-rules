import { expect, expectTypeOf, it } from "@effect/vitest";
import {
  CurrentActor,
  defineFeature,
  Forbidden,
  May,
  Runtime,
  runFeature,
  StepTrace,
} from "@house-rules/application";
import { Actor, ActorId, memoryUnitOfWork, UnitOfWork, type Permission } from "@house-rules/domain";
import { Effect, Layer } from "effect";
import {
  bindPush,
  Push,
  PushMount,
  PushOperations,
  PushSubscriptionNotFound,
  PushInputInvalid,
  MemoryPushOutbox,
} from "../index.js";

expectTypeOf<Parameters<typeof bindPush>[0]>().toEqualTypeOf<Push["Service"]>();
const actor = Actor.make({ id: ActorId.make("runtime-owner") });
const owner = { kind: "person", id: actor.id };
const { subscribe, unsubscribe, listMine, isSubscribed, subscriptionsFor, forgetExpired } =
  PushOperations;
const add = defineFeature("test_subscribe", {
  ...subscribe,
  permission: null,
  edges: [subscribe],
  handler: (input, { call }) => call(subscribe, input),
});
const remove = defineFeature("test_unsubscribe", {
  ...unsubscribe,
  permission: null,
  edges: [unsubscribe],
  handler: (input, { call }) => call(unsubscribe, input),
});
const list = defineFeature("test_listMine", {
  ...listMine,
  permission: null,
  edges: [listMine],
  handler: (input, { call }) => call(listMine, input),
});
const check = defineFeature("test_isSubscribed", {
  ...isSubscribed,
  permission: null,
  edges: [isSubscribed],
  handler: (input, { call }) => call(isSubscribed, input),
});
const deliveries = defineFeature("test_subscriptionsFor", {
  ...subscriptionsFor,
  permission: null,
  edges: [subscriptionsFor],
  start: { kind: "system", reason: "deliver", startedBy: "hook:test" },
  handler: (input, { call }) => call(subscriptionsFor, input),
});
const expire = defineFeature("test_forgetExpired", {
  ...forgetExpired,
  permission: null,
  edges: [forgetExpired],
  start: { kind: "system", reason: "gone", startedBy: "hook:test" },
  handler: (input, { call }) => call(forgetExpired, input),
});
const systemAdd = defineFeature("test_systemSubscribe", {
  ...subscribe,
  permission: null,
  edges: [subscribe],
  start: { kind: "system", reason: "test", startedBy: "hook:test" },
  handler: (input, { call }) => call(subscribe, input),
});
const systemRemove = defineFeature("test_systemUnsubscribe", {
  ...unsubscribe,
  permission: null,
  edges: [unsubscribe],
  start: { kind: "system", reason: "test", startedBy: "hook:test" },
  handler: (input, { call }) => call(unsubscribe, input),
});
const systemList = defineFeature("test_systemListMine", {
  ...listMine,
  permission: null,
  edges: [listMine],
  start: { kind: "system", reason: "test", startedBy: "hook:test" },
  handler: (input, { call }) => call(listMine, input),
});
const systemCheck = defineFeature("test_systemIsSubscribed", {
  ...isSubscribed,
  permission: null,
  edges: [isSubscribed],
  start: { kind: "system", reason: "test", startedBy: "hook:test" },
  handler: (input, { call }) => call(isSubscribed, input),
});
const deliver = defineFeature("test_deliver", {
  ...PushOperations.deliver,
  permission: null,
  edges: [PushOperations.deliver],
  start: { kind: "system", reason: "deliver", startedBy: "hook:test" },
  handler: (input, { call }) => call(PushOperations.deliver, input),
});
const personDeliver = defineFeature("test_personDeliver", {
  ...PushOperations.deliver,
  permission: null,
  edges: [PushOperations.deliver],
  handler: (input, { call }) => call(PushOperations.deliver, input),
});
const features = [
  deliver,
  personDeliver,
  add,
  remove,
  list,
  check,
  deliveries,
  expire,
  systemAdd,
  systemRemove,
  systemList,
  systemCheck,
];
const permissions = ["push:read", "push:write", "push:deliver"] as const;
const world = Runtime.layer({ mounts: [PushMount], features, ways: [] }).pipe(
  Layer.provideMerge(Push.layerMemoryTesting()),
  Layer.provideMerge(memoryUnitOfWork),
  Layer.provideMerge(StepTrace.layer()),
);
const caller = (
  granted: ReadonlyArray<Permission> = permissions,
  system: ReadonlyArray<Permission> = permissions,
) =>
  Layer.merge(
    Layer.succeed(CurrentActor, actor),
    Layer.succeedContext(May.context(May.fixed(granted), { features, system, via: "test" })),
  );
const data = (name: string) => ({
  endpoint: `https://push.example/runtime-${name}`,
  keys: { p256dh: "key", auth: "auth" },
});

it.layer(world)("Push operation bindings", (test) => {
  test.effect("mount binds all seven operations with declared names, permissions and flags", () =>
    Effect.gen(function* () {
      expect(PushMount.service).toBe(Push);
      expect(PushMount.bind).toBe(bindPush);
      expect(PushMount.operations).toEqual(Object.values(PushOperations));
      expect(
        PushMount.operations.map((op) => [
          op.name,
          op.permission,
          op.readOnly,
          op.transactional,
          op.destructive,
          op.needsApproval,
        ]),
      ).toEqual([
        ["Push.subscribe", "push:write", false, true, false, false],
        ["Push.unsubscribe", "push:write", false, true, true, false],
        ["Push.listMine", "push:read", true, false, false, false],
        ["Push.isSubscribed", "push:read", true, false, false, false],
        ["Push.subscriptionsFor", "push:deliver", true, false, false, false],
        ["Push.forgetExpired", "push:deliver", false, true, false, false],
        ["Push.deliver", "push:deliver", false, true, false, false],
      ]);
      expect((yield* Runtime).permissions).toEqual([...permissions].sort());
      const input = data("roundtrip");
      const result = yield* runFeature(add, input).pipe(Effect.provide(caller()));
      expect(result.events).toEqual([{ _tag: "Subscribed", endpoint: input.endpoint, owner }]);
      expect(yield* runFeature(list, {}).pipe(Effect.provide(caller()))).toContainEqual(
        result.subscription,
      );
      expect(
        yield* runFeature(check, { endpoint: input.endpoint }).pipe(Effect.provide(caller())),
      ).toBe(true);
      expect(
        yield* runFeature(remove, { endpoint: input.endpoint }).pipe(Effect.provide(caller())),
      ).toEqual({ events: [{ _tag: "Unsubscribed", endpoint: input.endpoint, owner }] });
      expect(
        yield* runFeature(check, { endpoint: input.endpoint }).pipe(Effect.provide(caller())),
      ).toBe(false);
    }),
  );
  test.effect("enforces read, write and system delivery permissions", () =>
    Effect.gen(function* () {
      const input = data("denied");
      expect(
        yield* Effect.flip(runFeature(add, input).pipe(Effect.provide(caller([])))),
      ).toBeInstanceOf(Forbidden);
      expect(
        yield* Effect.flip(runFeature(remove, input).pipe(Effect.provide(caller([])))),
      ).toBeInstanceOf(Forbidden);
      expect(
        yield* Effect.flip(runFeature(list, {}).pipe(Effect.provide(caller([])))),
      ).toBeInstanceOf(Forbidden);
      expect(
        yield* Effect.flip(runFeature(check, input).pipe(Effect.provide(caller([])))),
      ).toBeInstanceOf(Forbidden);
      expect(
        yield* Effect.flip(
          runFeature(deliveries, { owner }).pipe(Effect.provide(caller(permissions, []))),
        ),
      ).toBeInstanceOf(Forbidden);
      expect(
        yield* Effect.flip(runFeature(expire, input).pipe(Effect.provide(caller(permissions, [])))),
      ).toBeInstanceOf(Forbidden);
    }),
  );
  test.effect(
    "system subscribe/unsubscribe conceal subscriptions and system own reads are empty",
    () =>
      Effect.gen(function* () {
        const input = data("system-person");
        yield* runFeature(add, input).pipe(Effect.provide(caller()));
        for (const feature of [systemAdd, systemRemove]) {
          const error = yield* Effect.flip(
            runFeature(feature, input).pipe(Effect.provide(caller())),
          );
          expect(error).toBeInstanceOf(PushSubscriptionNotFound);
          expect(error.kind).toBe("not_found");
        }
        expect(yield* runFeature(systemList, {}).pipe(Effect.provide(caller()))).toEqual([]);
        expect(yield* runFeature(systemCheck, input).pipe(Effect.provide(caller()))).toBe(false);
        expect(yield* runFeature(check, input).pipe(Effect.provide(caller()))).toBe(true);
      }),
  );
  test.effect("system delivery reads subscriptions and marks gone endpoints expired", () =>
    Effect.gen(function* () {
      const input = data("delivery");
      const added = yield* runFeature(add, input).pipe(Effect.provide(caller()));
      expect(
        yield* runFeature(deliveries, { owner }).pipe(Effect.provide(caller())),
      ).toContainEqual(added.subscription);
      expect(yield* runFeature(expire, input).pipe(Effect.provide(caller()))).toEqual({
        events: [{ _tag: "SubscriptionExpired", endpoint: input.endpoint }],
      });
      expect(yield* runFeature(check, input).pipe(Effect.provide(caller()))).toBe(false);
      expect(yield* runFeature(expire, data("missing")).pipe(Effect.provide(caller()))).toEqual({
        events: [],
      });
    }),
  );
  test.effect("deliver is system-only and enforces push:deliver before sending", () =>
    Effect.gen(function* () {
      const input = data("deliver");
      const recipient = Actor.make({ id: ActorId.make("delivery-only-owner") });
      const push = yield* Push;
      yield* UnitOfWork.atomic(push.subscribe(recipient, input));
      const message = {
        owner: { kind: "person", id: recipient.id },
        payload: { title: "Ready" },
        idempotencyKey: "ledger-1",
      };
      const outbox = yield* MemoryPushOutbox;
      const before = yield* outbox.sends;
      expect(
        yield* Effect.flip(runFeature(personDeliver, message).pipe(Effect.provide(caller()))),
      ).toBeInstanceOf(PushSubscriptionNotFound);
      expect(
        yield* Effect.flip(
          runFeature(deliver, message).pipe(Effect.provide(caller(permissions, []))),
        ),
      ).toBeInstanceOf(Forbidden);
      expect(yield* outbox.sends).toEqual(before);
      expect(yield* runFeature(deliver, message).pipe(Effect.provide(caller()))).toEqual({
        sent: 1,
        expired: 0,
        events: [],
      });
      expect((yield* outbox.sends).at(-1)?.options).toEqual({
        ttl: 86400,
        idempotencyKey: "ledger-1",
      });
    }),
  );
  test.effect("invalid endpoints and empty keys produce PushInputInvalid through the binding", () =>
    Effect.gen(function* () {
      for (const input of [
        { ...data("invalid"), endpoint: "http://push.example/insecure" },
        { ...data("invalid"), endpoint: "not a URL" },
        { ...data("invalid"), endpoint: "" },
        { ...data("invalid"), keys: { p256dh: "", auth: "auth" } },
        { ...data("invalid"), keys: { p256dh: "key", auth: "" } },
      ]) {
        const error = yield* Effect.flip(runFeature(add, input).pipe(Effect.provide(caller())));
        expect(error).toBeInstanceOf(PushInputInvalid);
        expect(error.kind).toBe("invalid");
      }
    }),
  );
});
