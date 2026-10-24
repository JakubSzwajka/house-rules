import { expect, expectTypeOf, it } from "@effect/vitest";
import { Actor, ActorId, memoryUnitOfWork, NoOpenUnit, UnitOfWork } from "@house-rules/domain";
import { Effect, Layer, Schema } from "effect";
import { TestClock } from "effect/testing";
import {
  Push,
  PushInputInvalid,
  PushSender,
  PushStore,
  PushSubscriptionConflict,
  PushSubscriptionNotFound,
} from "../index.js";

expectTypeOf<Parameters<typeof Push.layerPostgres>[1]>().toEqualTypeOf<Layer.Layer<PushSender>>();
expectTypeOf<Parameters<typeof Push.layerPostgres>>().toExtend<
  readonly [unknown, Layer.Layer<PushSender>]
>();
expectTypeOf<Layer.Services<ReturnType<typeof Push.layer>>>().toEqualTypeOf<
  PushSender | PushStore
>();

const world = Push.layerMemory().pipe(Layer.provideMerge(memoryUnitOfWork));
const actor = Actor.make({ id: ActorId.make("person-a") });
const other = Actor.make({ id: ActorId.make("person-b") });
const owner = { kind: "person", id: actor.id };
const input = (name: string) => ({
  endpoint: `https://push.example/${name}`,
  keys: { p256dh: "key", auth: "secret" },
});
class Rollback extends Schema.TaggedError<Rollback>()("Rollback", {}) {}

it.effect("rejects an invalid default TTL at module acquisition", () =>
  Effect.gen(function* () {
    for (const defaultTtlSeconds of [0, -1, 1.5]) {
      expect(
        yield* Effect.flip(
          Effect.service(Push).pipe(Effect.provide(Push.layerMemory({ defaultTtlSeconds }))),
        ),
      ).toBeInstanceOf(PushInputInvalid);
    }
  }),
);

it.layer(world)("Push", (test) => {
  test.effect("scopes listMine, isSubscribed and subscriptionsFor to the owner", () =>
    Effect.gen(function* () {
      const push = yield* Push;
      const data = input("owner-reads");
      const result = yield* UnitOfWork.atomic(push.subscribe(actor, data));
      expect(result.subscription.owner).toEqual(owner);
      expect(result.events).toEqual([{ _tag: "Subscribed", endpoint: data.endpoint, owner }]);
      expect(yield* push.listMine(actor)).toContainEqual(result.subscription);
      expect(yield* push.listMine(other)).not.toContainEqual(result.subscription);
      expect(yield* push.subscriptionsFor(owner)).toContainEqual(result.subscription);
      expect(yield* push.subscriptionsFor({ kind: "org", id: actor.id })).toEqual([]);
      expect(yield* push.isSubscribed(actor, data.endpoint)).toBe(true);
      expect(yield* push.isSubscribed(other, data.endpoint)).toBe(false);
    }),
  );
  test.effect("same-owner re-subscribe is idempotent and preserves createdAt", () =>
    Effect.gen(function* () {
      const push = yield* Push;
      const data = input("idempotent");
      const first = yield* UnitOfWork.atomic(push.subscribe(actor, data));
      yield* TestClock.adjust(1000);
      const again = yield* UnitOfWork.atomic(
        push.subscribe(actor, { ...data, keys: { p256dh: "changed", auth: "changed" } }),
      );
      expect(again).toEqual({ subscription: first.subscription, events: [] });
    }),
  );
  test.effect("rejects endpoint theft and unsubscription by another owner", () =>
    Effect.gen(function* () {
      const push = yield* Push;
      const data = input("theft");
      yield* UnitOfWork.atomic(push.subscribe(actor, data));
      expect(yield* Effect.flip(UnitOfWork.atomic(push.subscribe(other, data)))).toBeInstanceOf(
        PushSubscriptionConflict,
      );
      expect(
        yield* Effect.flip(UnitOfWork.atomic(push.unsubscribe(other, data.endpoint))),
      ).toBeInstanceOf(PushSubscriptionNotFound);
      expect(yield* push.isSubscribed(actor, data.endpoint)).toBe(true);
    }),
  );
  test.effect("unsubscribe returns Unsubscribed and removes the endpoint", () =>
    Effect.gen(function* () {
      const push = yield* Push;
      const data = input("unsubscribe");
      yield* UnitOfWork.atomic(push.subscribe(actor, data));
      expect(yield* UnitOfWork.atomic(push.unsubscribe(actor, data.endpoint))).toEqual({
        events: [{ _tag: "Unsubscribed", endpoint: data.endpoint, owner }],
      });
      expect(yield* push.isSubscribed(actor, data.endpoint)).toBe(false);
      expect(
        yield* Effect.flip(UnitOfWork.atomic(push.unsubscribe(actor, data.endpoint))),
      ).toBeInstanceOf(PushSubscriptionNotFound);
    }),
  );
  test.effect("expiry hides subscriptions and re-subscribe clears the mark", () =>
    Effect.gen(function* () {
      const push = yield* Push;
      const data = input("expiry");
      const first = yield* UnitOfWork.atomic(push.subscribe(actor, data));
      expect(yield* UnitOfWork.atomic(push.forgetExpired(data.endpoint))).toEqual({
        events: [{ _tag: "SubscriptionExpired", endpoint: data.endpoint }],
      });
      expect(yield* push.isSubscribed(actor, data.endpoint)).toBe(false);
      expect((yield* push.listMine(actor)).some((x) => x.endpoint === data.endpoint)).toBe(false);
      expect((yield* push.subscriptionsFor(owner)).some((x) => x.endpoint === data.endpoint)).toBe(
        false,
      );
      expect(yield* UnitOfWork.atomic(push.forgetExpired(data.endpoint))).toEqual({ events: [] });
      expect(yield* Effect.flip(UnitOfWork.atomic(push.subscribe(other, data)))).toBeInstanceOf(
        PushSubscriptionConflict,
      );
      yield* TestClock.adjust(1000);
      const renewed = yield* UnitOfWork.atomic(push.subscribe(actor, data));
      expect(renewed.subscription).toEqual(first.subscription);
      expect(renewed.events).toEqual(first.events);
      expect(yield* push.isSubscribed(actor, data.endpoint)).toBe(true);
    }),
  );
  test.effect("forgetExpired on an unknown endpoint returns no events", () =>
    Effect.gen(function* () {
      const push = yield* Push;
      expect(yield* UnitOfWork.atomic(push.forgetExpired(input("unknown").endpoint))).toEqual({
        events: [],
      });
    }),
  );
  test.effect("validates HTTPS endpoints and nonempty keys with PushInputInvalid", () =>
    Effect.gen(function* () {
      const push = yield* Push;
      for (const data of [
        { ...input("invalid"), endpoint: "not a url" },
        { ...input("invalid"), endpoint: "http://push.example/insecure" },
        { ...input("invalid"), endpoint: "" },
        { ...input("invalid"), keys: { p256dh: "", auth: "secret" } },
        { ...input("invalid"), keys: { p256dh: "key", auth: "" } },
      ]) {
        const error = yield* Effect.flip(UnitOfWork.atomic(push.subscribe(actor, data)));
        expect(error).toBeInstanceOf(PushInputInvalid);
        expect(error.kind).toBe("invalid");
      }
    }),
  );
  test.effect("every facade write requires an open unit", () =>
    Effect.gen(function* () {
      const push = yield* Push;
      const data = input("outside");
      expect(yield* Effect.flip(push.subscribe(actor, data))).toBeInstanceOf(NoOpenUnit);
      expect(yield* Effect.flip(push.unsubscribe(actor, data.endpoint))).toBeInstanceOf(NoOpenUnit);
      expect(yield* Effect.flip(push.forgetExpired(data.endpoint))).toBeInstanceOf(NoOpenUnit);
      expect(yield* Effect.flip(push.erase(owner))).toBeInstanceOf(NoOpenUnit);
    }),
  );
  test.effect("memory rollback restores updates, deletions, expiry and inserts", () =>
    Effect.gen(function* () {
      const push = yield* Push;
      const data = input("rollback-existing");
      const fresh = input("rollback-new");
      yield* UnitOfWork.atomic(push.subscribe(actor, data));
      const error = yield* Effect.flip(
        UnitOfWork.atomic(
          Effect.gen(function* () {
            yield* push.forgetExpired(data.endpoint);
            yield* push.subscribe(actor, data);
            yield* push.unsubscribe(actor, data.endpoint);
            yield* push.subscribe(actor, fresh);
            yield* push.erase(owner);
            return yield* new Rollback();
          }),
        ),
      );
      expect(error).toBeInstanceOf(Rollback);
      expect(yield* push.isSubscribed(actor, data.endpoint)).toBe(true);
      expect(yield* push.isSubscribed(actor, fresh.endpoint)).toBe(false);
    }),
  );
  test.effect("facade erase deletes active and expired rows only for its owner", () =>
    Effect.gen(function* () {
      const push = yield* Push;
      const erased = Actor.make({ id: ActorId.make("erase-owner") });
      const active = input("erase-active");
      const expired = input("erase-expired");
      const kept = input("erase-keep");
      yield* UnitOfWork.atomic(
        Effect.gen(function* () {
          yield* push.subscribe(erased, active);
          yield* push.subscribe(erased, expired);
          yield* push.forgetExpired(expired.endpoint);
          yield* push.subscribe(other, kept);
          yield* push.erase({ kind: "person", id: erased.id });
        }),
      );
      expect(yield* push.listMine(erased)).toEqual([]);
      expect(yield* push.isSubscribed(other, kept.endpoint)).toBe(true);
      // A new owner can now claim the erased, formerly expired endpoint.
      expect((yield* UnitOfWork.atomic(push.subscribe(other, expired))).subscription.owner.id).toBe(
        other.id,
      );
    }),
  );
});
