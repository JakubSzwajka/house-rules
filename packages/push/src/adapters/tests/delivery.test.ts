import { expect, layer } from "@effect/vitest";
import { Actor, ActorId, NoOpenUnit, UnitOfWork } from "@house-rules/domain";
import { Effect, Layer, Schema } from "effect";
import {
  MemoryPushOutbox,
  memoryPushSender,
  Push,
  PushInputInvalid,
  PushSender,
  PushSendFailed,
  PushStore,
} from "../../index.js";
import { pushStores } from "./stores.js";

const actor = Actor.make({ id: ActorId.make("delivery-owner") });
const owner = { kind: "person", id: actor.id };
const input = (name: string) => ({
  endpoint: `https://push.example/deliver-${name}`,
  keys: { p256dh: "key", auth: "auth" },
});
const payload = { title: "An update" };
class Rollback extends Schema.TaggedError<Rollback>()("Rollback", {}) {}

for (const store of pushStores) {
  const world = Push.layer({ defaultTtlSeconds: 3600 }).pipe(
    Layer.provideMerge(memoryPushSender({ results: { [input("gone").endpoint]: "gone" } })),
    Layer.provideMerge(store.layer),
  );
  layer(world, { excludeTestServices: true, timeout: "30 seconds" })(
    `Push.deliver ${store.name}`,
    (test) => {
      test.effect("sends to every active subscription only, with TTL and idempotency key", () =>
        Effect.gen(function* () {
          const push = yield* Push;
          const outbox = yield* MemoryPushOutbox;
          const other = Actor.make({ id: ActorId.make("delivery-other") });
          yield* UnitOfWork.atomic(
            Effect.gen(function* () {
              for (const name of ["active-a", "active-b", "old"])
                yield* push.subscribe(actor, input(name));
              yield* push.forgetExpired(input("old").endpoint);
              yield* push.subscribe(other, input("other"));
            }),
          );
          const before = (yield* outbox.sends).length;
          expect(yield* UnitOfWork.atomic(push.deliver(owner, payload, "ledger-active"))).toEqual({
            sent: 2,
            expired: 0,
            events: [],
          });
          const attempts = (yield* outbox.sends).slice(before);
          expect(attempts.map((send) => send.subscription.endpoint).sort()).toEqual([
            input("active-a").endpoint,
            input("active-b").endpoint,
          ]);
          for (const send of attempts) {
            expect(send.payload).toEqual(payload);
            expect(send.options).toEqual({ ttl: 3600, idempotencyKey: "ledger-active" });
          }
          yield* UnitOfWork.atomic(push.deliver(owner, payload, "ledger-override", 60));
          expect((yield* outbox.sends).slice(-2).map((send) => send.options)).toEqual([
            { ttl: 60, idempotencyKey: "ledger-override" },
            { ttl: 60, idempotencyKey: "ledger-override" },
          ]);
          yield* UnitOfWork.atomic(push.erase(owner));
        }),
      );
      test.effect(
        "gone soft-expires the endpoint and returns SubscriptionExpired after commit",
        () =>
          Effect.gen(function* () {
            const push = yield* Push;
            const storage = yield* PushStore;
            const subscription = (yield* UnitOfWork.atomic(push.subscribe(actor, input("gone"))))
              .subscription;
            expect(yield* UnitOfWork.atomic(push.deliver(owner, payload, "ledger-gone"))).toEqual({
              sent: 0,
              expired: 1,
              events: [{ _tag: "SubscriptionExpired", endpoint: subscription.endpoint }],
            });
            const expired = yield* storage.getIncludingExpired(subscription.endpoint);
            expect(expired).toEqual({ ...subscription, expiredAt: expect.any(Number) });
            expect(yield* push.subscriptionsFor(owner)).toEqual([]);
            expect(
              yield* UnitOfWork.atomic(push.deliver(owner, payload, "ledger-gone-again")),
            ).toEqual({ sent: 0, expired: 0, events: [] });
            yield* UnitOfWork.atomic(push.erase(owner));
          }),
      );
      test.effect("a later sender failure rolls back every expiry in the same call", () =>
        Effect.gen(function* () {
          const push = yield* Push;
          const storage = yield* PushStore;
          for (const name of ["fail-a", "fail-b"])
            yield* UnitOfWork.atomic(push.subscribe(actor, input(name)));
          const cause = { provider: "private-provider-detail" };
          let attempts = 0;
          const failAfterGone = Layer.succeed(PushSender, {
            send: () =>
              Effect.suspend(() => {
                attempts++;
                return attempts === 1
                  ? Effect.succeed("gone" as const)
                  : Effect.fail(new PushSendFailed({ cause }));
              }),
          });
          const error = yield* Effect.flip(
            Effect.gen(function* () {
              const delivery = yield* Push;
              return yield* UnitOfWork.atomic(delivery.deliver(owner, payload, "ledger-fail"));
            }).pipe(Effect.provide(Push.layer({}).pipe(Layer.provide(failAfterGone)))),
          );
          expect(error).toBeInstanceOf(PushSendFailed);
          expect(error.kind).toBe("unavailable");
          expect(error.message).toBe("Push delivery is unavailable. Try again shortly.");
          expect(error).toMatchObject({ cause });
          expect(attempts).toBe(2);
          for (const name of ["fail-a", "fail-b"])
            expect(
              (yield* storage.getIncludingExpired(input(name).endpoint))?.expiredAt,
            ).toBeUndefined();
          expect(yield* push.subscriptionsFor(owner)).toHaveLength(2);
          yield* UnitOfWork.atomic(push.erase(owner));
        }),
      );
      test.effect("an outer rollback undoes successful gone expiry", () =>
        Effect.gen(function* () {
          const push = yield* Push;
          yield* UnitOfWork.atomic(push.subscribe(actor, input("gone")));
          yield* Effect.flip(
            UnitOfWork.atomic(
              Effect.gen(function* () {
                expect((yield* push.deliver(owner, payload, "ledger-rollback")).expired).toBe(1);
                return yield* new Rollback();
              }),
            ),
          );
          expect(yield* push.subscriptionsFor(owner)).toHaveLength(1);
          yield* UnitOfWork.atomic(push.erase(owner));
        }),
      );
      test.effect("convenience facade layer captures the supplied sender and TTL", () =>
        Effect.gen(function* () {
          const sender = memoryPushSender({ result: "gone" });
          const module = store.facadeLayer({ defaultTtlSeconds: 15 }, sender);
          yield* Effect.gen(function* () {
            const push = yield* Push;
            const outbox = yield* MemoryPushOutbox;
            const data = input("facade");
            yield* UnitOfWork.atomic(push.subscribe(actor, data));
            expect(yield* UnitOfWork.atomic(push.deliver(owner, payload, "ledger-facade"))).toEqual(
              {
                sent: 0,
                expired: 1,
                events: [{ _tag: "SubscriptionExpired", endpoint: data.endpoint }],
              },
            );
            expect((yield* outbox.sends).at(-1)?.options).toEqual({
              ttl: 15,
              idempotencyKey: "ledger-facade",
            });
            expect(yield* push.subscriptionsFor(owner)).toEqual([]);
            yield* UnitOfWork.atomic(push.erase(owner));
          }).pipe(Effect.provide(module.pipe(Layer.provideMerge(sender))));
        }),
      );
      test.effect("requires an open unit even for an owner with no subscriptions", () =>
        Effect.gen(function* () {
          const push = yield* Push;
          const outbox = yield* MemoryPushOutbox;
          const before = yield* outbox.sends;
          expect(yield* Effect.flip(push.deliver(owner, payload, "ledger-outside"))).toBeInstanceOf(
            NoOpenUnit,
          );
          expect(yield* outbox.sends).toEqual(before);
        }),
      );
      test.effect("rejects nonpositive or fractional TTL without sending", () =>
        Effect.gen(function* () {
          const push = yield* Push;
          const outbox = yield* MemoryPushOutbox;
          const before = yield* outbox.sends;
          for (const ttl of [0, -1, 0.5, Number.NaN])
            expect(
              yield* Effect.flip(
                UnitOfWork.atomic(push.deliver(owner, payload, "ledger-invalid", ttl)),
              ),
            ).toBeInstanceOf(PushInputInvalid);
          expect(yield* outbox.sends).toEqual(before);
        }),
      );
    },
  );
}
