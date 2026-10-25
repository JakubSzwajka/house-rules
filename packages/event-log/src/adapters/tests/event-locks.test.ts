import { expect, layer } from "@effect/vitest";
import { UnitOfWork } from "@house-rules/domain";
import { Deferred, Effect, Fiber, Schema, Stream } from "effect";
import { EventLog, EventStore, type EventLogOptions, type DeliveryToken } from "../../index.js";
import { atTesting as at } from "./event-log-testing.js";
import { stores } from "./stores.js";
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
    `Event locks on ${name}`,
    (it) => {
      it.effect(
        "serializes global appends until commit, so a later cursor cannot hide an earlier event",
        () =>
          Effect.gen(function* () {
            const log = yield* EventLog;
            const entered = yield* Deferred.make<void>();
            const release = yield* Deferred.make<void>();
            const started = yield* Deferred.make<void>();
            const first = yield* UnitOfWork.atomic(
              Effect.gen(function* () {
                const event = yield* log.record(null, fact("commit-order", "first"));
                yield* Deferred.succeed(entered, undefined);
                yield* Deferred.await(release);
                return event;
              }),
            ).pipe(Effect.forkChild);
            yield* Deferred.await(entered);
            const second = yield* Deferred.succeed(started, undefined).pipe(
              Effect.andThen(UnitOfWork.atomic(log.record(null, fact("commit-order", "second")))),
              Effect.forkChild,
            );
            yield* Deferred.await(started);
            expect(yield* second.pipe(Fiber.join, Effect.timeoutOption("25 millis"))).toEqual(
              expect.objectContaining({ _tag: "None" }),
            );
            yield* Deferred.succeed(release, undefined);
            const a = yield* Fiber.join(first);
            const b = yield* Fiber.join(second);
            expect(BigInt(a.id) < BigInt(b.id)).toBe(true);
            expect((yield* log.read({ kinds: ["commit-order"] })).map((event) => event.id)).toEqual(
              [a.id, b.id],
            );
          }).pipe(Effect.provide(EventLog.layer(options("commit-order")))),
      );
      it.effect(
        "holds a consumer cursor across the whole handler unit and rejects the competing token",
        () =>
          Effect.gen(function* () {
            const log = yield* EventLog;
            yield* UnitOfWork.atomic(log.record(null, fact("cursor-lock")));
            const claimed = token(yield* UnitOfWork.atomic(log.claimDue()));
            const entered = yield* Deferred.make<void>();
            const release = yield* Deferred.make<void>();
            const first = yield* UnitOfWork.atomic(
              Effect.gen(function* () {
                expect(yield* log.takeNext(claimed)).not.toBeNull();
                yield* Deferred.succeed(entered, undefined);
                yield* Deferred.await(release);
                return yield* log.settleSuccess(claimed);
              }),
            ).pipe(Effect.forkChild);
            yield* Deferred.await(entered);
            if (name === "postgres") {
              expect(yield* UnitOfWork.atomic(log.takeNext(claimed))).toBeNull();
              expect(yield* UnitOfWork.atomic(log.claimDue())).toEqual([]);
            }
            yield* Deferred.succeed(release, undefined);
            expect(yield* Fiber.join(first)).toBe(true);
            expect(yield* UnitOfWork.atomic(log.takeNext(claimed))).toBeNull();
          }).pipe(
            Effect.provide(
              EventLog.layer(
                options("cursor-lock", [{ name: "cursor-lock", kinds: ["cursor-lock"] }]),
              ),
            ),
          ),
      );
      it.effect(
        "paginates dead letters sharing an event and does not reset already queued replays",
        () =>
          Effect.gen(function* () {
            const log = yield* EventLog;
            const a = yield* UnitOfWork.atomic(log.record(null, fact("queue-page")));
            const b = yield* UnitOfWork.atomic(log.record(null, fact("queue-page")));
            yield* at(0, UnitOfWork.atomic(log.claimDue()));
            yield* at(1000, UnitOfWork.atomic(log.claimDue()));
            yield* at(1000, UnitOfWork.atomic(log.claimDue()));
            yield* at(2000, UnitOfWork.atomic(log.claimDue()));
            const [one] = yield* log.listDeadLetters({
              limit: 1,
              after: { eventId: a.id, consumer: "a" },
            });
            expect(one).toMatchObject({ eventId: a.id, consumer: "queue-a" });
            const [two] = yield* log.listDeadLetters({
              limit: 1,
              after: { eventId: a.id, consumer: "queue-a" },
            });
            expect(two).toMatchObject({ eventId: a.id, consumer: "queue-b" });
            yield* UnitOfWork.atomic(log.replay("queue-a", b.id));
            yield* UnitOfWork.atomic(log.replay("queue-a", a.id));
            expect(yield* UnitOfWork.atomic(log.replay("queue-a", b.id))).toBe("already_queued");
            const next = token(
              yield* at(2000, UnitOfWork.atomic(log.claimDue({ consumer: "queue-a" }))),
            );
            expect(next.eventId).toBe(a.id);
            yield* UnitOfWork.atomic(log.settleSuccess(next));
            const following = token(
              yield* at(2000, UnitOfWork.atomic(log.claimDue({ consumer: "queue-a" }))),
            );
            expect(following.eventId).toBe(b.id);
          }).pipe(
            Effect.provide(
              EventLog.layer(
                options("queue-page", [
                  { name: "queue-a", kinds: ["queue-page"], maxAttempts: 1 },
                  { name: "queue-b", kinds: ["queue-page"], maxAttempts: 1 },
                ]),
              ),
            ),
          ),
      );
      it.effect("emits adapter wakeups that can drive a caller-owned hook", () =>
        Effect.gen(function* () {
          const store = yield* EventStore;
          const received = yield* Deferred.make<void>();
          const listening = yield* store.wakeups.pipe(
            Stream.take(1),
            Stream.runForEach(() => Deferred.succeed(received, undefined)),
            Effect.forkChild,
          );
          // Signals are hints. A notification can race LISTEN acquisition, so keep nudging until registered.
          const notify = UnitOfWork.atomic(
            store.append({ ...fact("signal"), occurredAt: 0, actorId: null, requestId: null }),
          );
          yield* Effect.raceFirst(
            Deferred.await(received),
            Effect.forever(notify.pipe(Effect.andThen(Effect.sleep("10 millis")))),
          ).pipe(Effect.timeout("5 seconds"));
          yield* Fiber.join(listening);
        }),
      );
    },
  );
}
