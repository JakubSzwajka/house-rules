import { CurrentUnit, type OpenUnit, UnitOfWork } from "@house-rules/domain";
import { Effect, Layer, PubSub, Stream } from "effect";
import type { Candidate, DeadLetter } from "../../event/delivery.js";
import type { StoredEvent } from "../../event/event.js";
import { EventStore } from "../../storage.js";

const order = (a: string, b: string) =>
  BigInt(a) < BigInt(b) ? -1 : BigInt(a) === BigInt(b) ? 0 : 1;
export const memoryEventStore = (): Layer.Layer<EventStore> =>
  Layer.effect(
    EventStore,
    Effect.gen(function* () {
      const signal = yield* PubSub.sliding<void>(1);
      yield* Effect.addFinalizer(() => PubSub.shutdown(signal));
      const rows = new Map<string, StoredEvent>();
      const positions = new Map<string, string>();
      const pending = new Map<string, Map<string, Candidate>>();
      const dead = new Map<string, Map<string, DeadLetter>>();
      const owners = new Map<string, OpenUnit>();
      let sequence = 0n;
      const change = Effect.fn("EventStore.memory.change")(function* (run: () => void) {
        yield* UnitOfWork.required;
        const before = structuredClone({ rows, positions, pending, dead, sequence });
        yield* UnitOfWork.onRollback(
          Effect.sync(() => {
            rows.clear();
            for (const [key, value] of before.rows) rows.set(key, value);
            positions.clear();
            for (const [key, value] of before.positions) positions.set(key, value);
            pending.clear();
            for (const [key, value] of before.pending) pending.set(key, value);
            dead.clear();
            for (const [key, value] of before.dead) dead.set(key, value);
            sequence = before.sequence;
          }),
        );
        run();
      });
      return EventStore.of({
        append: Effect.fn("EventStore.memory.append")(function* (event) {
          let stored: StoredEvent = { ...event, id: "1" };
          yield* change(() => {
            sequence += 1n;
            stored = structuredClone({ ...event, id: sequence.toString() });
            rows.set(stored.id, stored);
          });
          yield* PubSub.publish(signal, undefined);
          return structuredClone(stored);
        }),
        read: (query) =>
          Effect.sync(() =>
            [...rows.values()]
              .filter(
                (event) =>
                  (query.after === undefined || order(event.id, query.after) > 0) &&
                  (query.kinds === undefined || query.kinds.includes(event.kind)) &&
                  (query.subject === undefined ||
                    (event.subject.kind === query.subject.kind &&
                      event.subject.id === query.subject.id)) &&
                  (query.scopeId === undefined || event.scopeId === query.scopeId) &&
                  (query.requestId === undefined || event.requestId === query.requestId) &&
                  (query.from === undefined || event.occurredAt >= query.from) &&
                  (query.to === undefined || event.occurredAt <= query.to),
              )
              .sort((a, b) => order(a.id, b.id))
              .slice(0, query.limit ?? 100)
              .map((row) => structuredClone(row)),
          ),
        lock: Effect.fn("EventStore.memory.lock")(function* (consumer) {
          yield* UnitOfWork.required;
          const unit = yield* CurrentUnit;
          if (unit === undefined) return false;
          const owner = owners.get(consumer);
          if (owner !== undefined && owner !== unit) {
            const active = yield* Effect.isSuccess(
              UnitOfWork.required.pipe(Effect.provideService(CurrentUnit, owner)),
            );
            if (active) return false;
          }
          owners.set(consumer, unit);
          yield* UnitOfWork.onRollback(
            Effect.sync(() => {
              if (owners.get(consumer) === unit) owners.delete(consumer);
            }),
          );
          return true;
        }),
        candidate: (consumer, kinds) =>
          Effect.sync(() => {
            const retries = pending.get(consumer);
            const replay = [...(retries?.values() ?? [])]
              .filter((row) => row.replay)
              .sort((a, b) => order(a.event.id, b.event.id))[0];
            if (replay !== undefined) return structuredClone(replay);
            const cursor = positions.get(consumer) ?? "0";
            const event = [...rows.values()]
              .filter((row) => order(row.id, cursor) > 0 && kinds.includes(row.kind))
              .sort((a, b) => order(a.id, b.id))[0];
            return event === undefined
              ? undefined
              : structuredClone(
                  retries?.get(event.id) ?? {
                    event,
                    attempts: 0,
                    nextDue: 0,
                    replay: false,
                    generation: "0",
                    lastError: "Delivery failed. See internal logs.",
                  },
                );
          }),
        retry: (consumer, candidate) =>
          change(() => {
            const entries = pending.get(consumer) ?? new Map<string, Candidate>();
            entries.set(candidate.event.id, structuredClone(candidate));
            pending.set(consumer, entries);
          }),
        enqueueReplay: Effect.fn("EventStore.memory.enqueueReplay")(
          function* (consumer, candidate) {
            yield* UnitOfWork.required;
            if (pending.get(consumer)?.has(candidate.event.id)) return false;
            yield* change(() => {
              const entries = pending.get(consumer) ?? new Map<string, Candidate>();
              entries.set(candidate.event.id, structuredClone(candidate));
              pending.set(consumer, entries);
            });
            return true;
          },
        ),
        advance: (consumer, eventId, replay) =>
          change(() => {
            pending.get(consumer)?.delete(eventId);
            if (!replay) positions.set(consumer, eventId);
          }),
        deadLetter: (row) =>
          change(() => {
            const entries = dead.get(row.consumer) ?? new Map<string, DeadLetter>();
            entries.set(row.eventId, structuredClone(row));
            dead.set(row.consumer, entries);
          }),
        listDeadLetters: (query) =>
          Effect.sync(() =>
            [...dead.values()]
              .flatMap((entries) => [...entries.values()])
              .filter(
                (row) =>
                  (query.consumer === undefined || row.consumer === query.consumer) &&
                  (query.after === undefined ||
                    order(row.eventId, query.after.eventId) > 0 ||
                    (row.eventId === query.after.eventId && row.consumer > query.after.consumer)),
              )
              .sort(
                (a, b) =>
                  order(a.eventId, b.eventId) ||
                  (a.consumer < b.consumer ? -1 : a.consumer === b.consumer ? 0 : 1),
              )
              .slice(0, query.limit ?? 100)
              .map((row) => structuredClone(row)),
          ),
        findDeadLetter: (consumer, eventId) =>
          Effect.sync(() => {
            const row = dead.get(consumer)?.get(eventId);
            return row === undefined ? undefined : structuredClone(row);
          }),
        clearDeadLetter: (consumer, eventId) =>
          change(() => {
            dead.get(consumer)?.delete(eventId);
          }),
        wakeups: Stream.fromPubSub(signal),
      });
    }),
  );
