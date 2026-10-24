import { expect, layer } from "@effect/vitest";
import { Actor, ActorId, NoOpenUnit, UnitOfWork } from "@house-rules/domain";
import { Effect, Schema } from "effect";
import {
  EventInputInvalid,
  EventLog,
  type EventLogOptions,
  type DeliveryToken,
} from "../../index.js";
import { stores } from "./stores.js";
import { atTesting as at } from "./event-log-testing.js";

class Rollback extends Schema.TaggedError<Rollback>()("Rollback", {}) {}
const actor = Actor.make({ id: ActorId.make("writer") });
const fact = (kind: string, text = "fact") => ({
  kind,
  subject: { kind: "task", id: "t1" },
  scopeId: "org",
  payload: { text },
});
const options = (kind: string, consumers: EventLogOptions["consumers"] = []) => ({
  registry: { [kind]: Schema.Struct({ text: Schema.String }) },
  consumers,
});
const token = (tokens: ReadonlyArray<DeliveryToken>) => {
  expect(tokens).toHaveLength(1);
  return tokens[0] as DeliveryToken;
};
for (const { name, layer: world } of stores) {
  layer(world, { excludeTestServices: true, timeout: "30 seconds" })(
    `Event log on ${name}`,
    (it) => {
      it.effect("validates the app registry and stamps an explicit actor, time and request", () =>
        Effect.gen(function* () {
          const log = yield* EventLog;
          const event = yield* at(
            1234,
            UnitOfWork.atomic(log.record(actor, fact("stamp"), "req-1")),
          );
          expect(event).toMatchObject({ actorId: "writer", occurredAt: 1234, requestId: "req-1" });
          expect(
            yield* log.read({
              kinds: ["stamp"],
              subject: { kind: "task", id: "t1" },
              scopeId: "org",
              requestId: "req-1",
              from: 1234,
              to: 1234,
            }),
          ).toEqual([event]);
          expect(yield* log.read({ kinds: [] })).toEqual([]);
          expect(
            yield* Effect.flip(UnitOfWork.atomic(log.record(null, fact("unknown")))),
          ).toBeInstanceOf(EventInputInvalid);
          expect(
            yield* Effect.flip(
              UnitOfWork.atomic(log.record(null, { ...fact("stamp"), payload: { text: 4 } })),
            ),
          ).toBeInstanceOf(EventInputInvalid);
          expect(yield* log.read({ kinds: ["stamp"], after: event.id })).toEqual([]);
        }).pipe(Effect.provide(EventLog.layer(options("stamp")))),
      );

      it.effect(
        "requires a unit for every write and rolls back both facts and consumer state",
        () =>
          Effect.gen(function* () {
            const log = yield* EventLog;
            const fake = {
              consumer: "units",
              eventId: "1",
              attempt: 1,
              replay: false,
              generation: "0",
            };
            for (const effect of [
              log.record(null, fact("units")).pipe(Effect.asVoid),
              log.claimDue().pipe(Effect.asVoid),
              log.takeNext(fake).pipe(Effect.asVoid),
              log.settleSuccess(fake).pipe(Effect.asVoid),
              log.settleFailure(fake, "safe").pipe(Effect.asVoid),
              log.replay("units", "1").pipe(Effect.asVoid),
            ]) {
              expect(yield* Effect.flip(effect)).toBeInstanceOf(NoOpenUnit);
            }
            yield* Effect.flip(
              UnitOfWork.atomic(
                log.record(null, fact("units")).pipe(Effect.andThen(new Rollback())),
              ),
            );
            expect(yield* log.read({ kinds: ["units"] })).toEqual([]);
            yield* UnitOfWork.atomic(log.record(null, fact("units")));
            yield* Effect.flip(
              UnitOfWork.atomic(log.claimDue().pipe(Effect.andThen(new Rollback()))),
            );
            expect(token(yield* at(1000, UnitOfWork.atomic(log.claimDue()))).attempt).toBe(1);
          }).pipe(
            Effect.provide(EventLog.layer(options("units", [{ name: "units", kinds: ["units"] }]))),
          ),
      );

      it.effect(
        "persists attempts before a failed handler unit and dead-letters without any failure callback",
        () =>
          Effect.gen(function* () {
            const log = yield* EventLog;
            const original = yield* UnitOfWork.atomic(log.record(null, fact("retry")));
            const next = yield* UnitOfWork.atomic(log.record(null, fact("retry", "next")));
            const first = token(yield* at(1000, UnitOfWork.atomic(log.claimDue())));
            yield* Effect.flip(
              UnitOfWork.atomic(
                Effect.gen(function* () {
                  expect((yield* log.takeNext(first))?.event.id).toBe(original.id);
                  yield* log.record(null, fact("retry", "handler write"));
                  yield* log.settleSuccess(first);
                  return yield* new Rollback();
                }),
              ),
            );
            expect((yield* log.read({ kinds: ["retry"] })).map((event) => event.id)).toEqual([
              original.id,
              next.id,
            ]);
            expect(yield* at(1999, log.due())).toEqual([]);
            expect(yield* at(1999, UnitOfWork.atomic(log.claimDue()))).toEqual([]);
            const second = token(yield* at(2000, UnitOfWork.atomic(log.claimDue())));
            expect(second.attempt).toBe(2);
            expect(yield* UnitOfWork.atomic(log.takeNext(first))).toBeNull();
            expect(yield* at(3999, UnitOfWork.atomic(log.claimDue()))).toEqual([]);
            expect(yield* at(4000, UnitOfWork.atomic(log.claimDue()))).toEqual([]);
            expect(yield* log.listDeadLetters({ consumer: "retry" })).toEqual([
              {
                consumer: "retry",
                eventId: original.id,
                attempts: 2,
                failedAt: 4000,
                lastError: "Delivery failed. See internal logs.",
              },
            ]);
            const following = token(yield* at(4000, UnitOfWork.atomic(log.claimDue())));
            expect(following.eventId).toBe(next.id);
            expect(yield* UnitOfWork.atomic(log.settleSuccess(following))).toBe(true);
          }).pipe(
            Effect.provide(
              EventLog.layer(
                options("retry", [{ name: "retry", kinds: ["retry"], maxAttempts: 2 }]),
              ),
            ),
          ),
      );

      it.effect(
        "keeps each consumer independent, caps backoff, and saves safe errors in a separate unit",
        () =>
          Effect.gen(function* () {
            const log = yield* EventLog;
            const event = yield* UnitOfWork.atomic(log.record(null, fact("independent")));
            const claims = yield* at(1000, UnitOfWork.atomic(log.claimDue()));
            const a = claims.find((item) => item.consumer === "consumer-a") as DeliveryToken;
            const b = claims.find((item) => item.consumer === "consumer-b") as DeliveryToken;
            expect(yield* UnitOfWork.atomic(log.settleSuccess(a))).toBe(true);
            yield* Effect.flip(
              UnitOfWork.atomic(log.takeNext(b).pipe(Effect.andThen(new Rollback()))),
            );
            expect(
              yield* UnitOfWork.atomic(log.settleFailure(b, "Consumer rejected the event.")),
            ).toBe(true);
            const b2 = token(yield* at(1010, UnitOfWork.atomic(log.claimDue())));
            expect(b2.consumer).toBe("consumer-b");
            expect(b2.attempt).toBe(2);
            expect(yield* at(1024, log.due())).toEqual([]);
            const b3 = token(yield* at(1025, UnitOfWork.atomic(log.claimDue())));
            expect(b3.attempt).toBe(3);
            expect(yield* at(1040, UnitOfWork.atomic(log.claimDue()))).toEqual([]);
            expect(yield* log.listDeadLetters({ consumer: "consumer-a" })).toEqual([]);
            expect(yield* log.listDeadLetters({ consumer: "consumer-b" })).toMatchObject([
              {
                consumer: "consumer-b",
                eventId: event.id,
                lastError: "Consumer rejected the event.",
                attempts: 3,
              },
            ]);
            expect(yield* UnitOfWork.atomic(log.settleFailure(b, "stale"))).toBe(false);
          }).pipe(
            Effect.provide(
              EventLog.layer(
                options("independent", [
                  { name: "consumer-a", kinds: ["independent"] },
                  {
                    name: "consumer-b",
                    kinds: ["independent"],
                    maxAttempts: 3,
                    backoff: { baseMs: 10, capMs: 15 },
                  },
                ]),
              ),
            ),
          ),
      );

      it.effect("manually replays only dead letters and fences stale replay tokens", () =>
        Effect.gen(function* () {
          const log = yield* EventLog;
          const event = yield* UnitOfWork.atomic(log.record(null, fact("replay")));
          const first = token(yield* at(0, UnitOfWork.atomic(log.claimDue())));
          yield* at(1000, UnitOfWork.atomic(log.claimDue()));
          expect(yield* UnitOfWork.atomic(log.replay("replay", event.id))).toBe("enqueued");
          const replay = token(yield* at(1000, UnitOfWork.atomic(log.claimDue())));
          expect(replay.replay).toBe(true);
          expect(yield* UnitOfWork.atomic(log.replay("replay", event.id))).toBe("already_queued");
          expect(yield* UnitOfWork.atomic(log.settleSuccess(first))).toBe(false);
          yield* at(2000, UnitOfWork.atomic(log.claimDue()));
          yield* UnitOfWork.atomic(log.replay("replay", event.id));
          const again = token(yield* at(2000, UnitOfWork.atomic(log.claimDue())));
          expect(again.generation).not.toBe(replay.generation);
          expect(yield* UnitOfWork.atomic(log.settleSuccess(replay))).toBe(false);
          expect(yield* UnitOfWork.atomic(log.settleSuccess(again))).toBe(true);
          expect(yield* log.listDeadLetters({ consumer: "replay" })).toEqual([]);
          expect(yield* log.due()).toEqual([]);
          expect((yield* Effect.flip(UnitOfWork.atomic(log.replay("replay", event.id))))._tag).toBe(
            "DeadLetterNotFound",
          );
          expect(
            yield* Effect.flip(UnitOfWork.atomic(log.replay("replay", "not-an-id"))),
          ).toBeInstanceOf(EventInputInvalid);
        }).pipe(
          Effect.provide(
            EventLog.layer(
              options("replay", [{ name: "replay", kinds: ["replay"], maxAttempts: 1 }]),
            ),
          ),
        ),
      );
    },
  );
}
