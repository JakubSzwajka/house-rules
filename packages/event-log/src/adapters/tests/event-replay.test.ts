import { expect, layer } from "@effect/vitest";
import { UnitOfWork } from "@house-rules/domain";
import { Deferred, Effect, Fiber, Schema } from "effect";
import { EventInputInvalid, EventLog, EventStore, type DeliveryToken } from "../../index.js";
import { atTesting as at } from "./event-log-testing.js";
import { stores } from "./stores.js";

const fact = (kind: string) => ({
  kind,
  subject: { kind: "task", id: "t1" },
  scopeId: null,
  payload: {},
});
const options = (name: string, kinds = [name]) => ({
  registry: Object.fromEntries(kinds.map((kind) => [kind, Schema.Struct({})])),
  consumers: [{ name, kinds, maxAttempts: 1 }],
});
const token = (tokens: ReadonlyArray<DeliveryToken>) => {
  expect(tokens).toHaveLength(1);
  return tokens[0] as DeliveryToken;
};
for (const { name, layer: world } of stores) {
  layer(world, { excludeTestServices: true, timeout: "30 seconds" })(
    `Event replay on ${name}`,
    (it) => {
      for (const outcome of ["success", "exhaustion"] as const) {
        const consumer = `replay-cursor-${outcome}`;
        it.effect(`never rewinds the normal cursor after replay ${outcome}`, () =>
          Effect.gen(function* () {
            const log = yield* EventLog;
            const old = yield* UnitOfWork.atomic(log.record(null, fact(consumer)));
            yield* at(0, UnitOfWork.atomic(log.claimDue()));
            yield* at(1000, UnitOfWork.atomic(log.claimDue()));
            // Move well beyond the old dead letter before replaying it.
            for (let index = 0; index < 2; index += 1) {
              const newer = yield* UnitOfWork.atomic(log.record(null, fact(consumer)));
              const claimed = token(yield* at(1000, UnitOfWork.atomic(log.claimDue())));
              expect(claimed.eventId).toBe(newer.id);
              expect(yield* UnitOfWork.atomic(log.settleSuccess(claimed))).toBe(true);
            }
            expect(yield* UnitOfWork.atomic(log.replay(consumer, old.id))).toBe("enqueued");
            const replay = token(yield* at(1000, UnitOfWork.atomic(log.claimDue())));
            expect(replay).toMatchObject({ eventId: old.id, replay: true });
            if (outcome === "success") {
              expect(yield* UnitOfWork.atomic(log.settleSuccess(replay))).toBe(true);
            } else {
              expect(yield* at(2000, UnitOfWork.atomic(log.claimDue()))).toEqual([]);
              expect(yield* log.listDeadLetters({ consumer })).toMatchObject([
                { eventId: old.id, attempts: 1, failedAt: 2000 },
              ]);
            }
            expect(yield* at(2000, log.due())).toEqual([]);
            const newest = yield* UnitOfWork.atomic(log.record(null, fact(consumer)));
            expect(token(yield* at(2000, UnitOfWork.atomic(log.claimDue()))).eventId).toBe(
              newest.id,
            );
          }).pipe(Effect.provide(EventLog.layer(options(consumer)))),
        );
      }
      it.effect("rejects replay when the event kind no longer belongs to the consumer", () =>
        Effect.gen(function* () {
          const log = yield* EventLog;
          const consumer = "replay-membership";
          const event = yield* UnitOfWork.atomic(log.record(null, fact(consumer)));
          yield* at(0, UnitOfWork.atomic(log.claimDue()));
          yield* at(1000, UnitOfWork.atomic(log.claimDue()));
          // Simulate a deployment that changes the registration but preserves history.
          const changed = options(consumer, [consumer, "replacement"]);
          changed.consumers[0] = { name: consumer, kinds: ["replacement"], maxAttempts: 1 };
          const result = yield* Effect.gen(function* () {
            const remounted = yield* EventLog;
            return yield* Effect.flip(UnitOfWork.atomic(remounted.replay(consumer, event.id)));
          }).pipe(Effect.provide(EventLog.layer(changed)));
          expect(result).toBeInstanceOf(EventInputInvalid);
          expect(yield* log.due()).toEqual([]);
        }).pipe(Effect.provide(EventLog.layer(options("replay-membership")))),
      );
      if (name === "postgres") {
        it.effect(
          "takes the consumer lock for replay and distinguishes busy from already queued",
          () =>
            Effect.gen(function* () {
              const log = yield* EventLog;
              const store = yield* EventStore;
              const consumer = "replay-lock";
              const event = yield* UnitOfWork.atomic(log.record(null, fact(consumer)));
              yield* at(0, UnitOfWork.atomic(log.claimDue()));
              yield* at(1000, UnitOfWork.atomic(log.claimDue()));
              const entered = yield* Deferred.make<void>();
              const release = yield* Deferred.make<void>();
              const holder = yield* UnitOfWork.atomic(
                Effect.gen(function* () {
                  expect(yield* store.lock(consumer)).toBe(true);
                  yield* Deferred.succeed(entered, undefined);
                  yield* Deferred.await(release);
                }),
              ).pipe(Effect.forkChild);
              yield* Deferred.await(entered);
              expect(yield* UnitOfWork.atomic(log.replay(consumer, event.id))).toBe("busy");
              yield* Deferred.succeed(release, undefined);
              yield* Fiber.join(holder);
              expect(yield* log.due()).toEqual([]);
              expect(yield* UnitOfWork.atomic(log.replay(consumer, event.id))).toBe("enqueued");
              expect(yield* UnitOfWork.atomic(log.replay(consumer, event.id))).toBe(
                "already_queued",
              );
            }).pipe(Effect.provide(EventLog.layer(options("replay-lock")))),
        );
      }
    },
  );
}
