import { type Actor, UnitOfWork } from "@house-rules/domain";
import { DateTime, Effect, Random, Schema } from "effect";
import { DeadLetterQuery, DeliveryToken, type ReplayResult } from "./delivery.js";
import type { EventStore } from "../storage.js";
import {
  DeadLetterNotFound,
  EventFact,
  EventId,
  EventInputInvalid,
  EventQuery,
  EventStoreUnavailable,
} from "./event.js";
import type { EventLogSettings } from "./options.js";

const invalid = () => new EventInputInvalid({ message: "Invalid event log input." });
const now = DateTime.now.pipe(Effect.map(DateTime.toEpochMillis));
const ClaimQuery = Schema.Struct({
  consumer: Schema.optionalKey(Schema.NonEmptyString),
  limit: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1000 }))),
});
export type ClaimQuery = typeof ClaimQuery.Type;
export const makeEventLog = (store: EventStore["Service"], options: EventLogSettings) => {
  const registration = (name: string) => {
    const consumer = options.consumers.find((entry) => entry.name === name);
    return consumer === undefined ? Effect.fail(invalid()) : Effect.succeed(consumer);
  };
  const decodePayload = Effect.fn("EventLog.decodePayload")(function* (fact: EventFact) {
    const schema = Object.hasOwn(options.registry, fact.kind)
      ? options.registry[fact.kind]
      : undefined;
    if (schema === undefined) return yield* invalid();
    return yield* Schema.decodeUnknownEffect(schema)(fact.payload).pipe(Effect.mapError(invalid));
  });
  const lockedCandidate = Effect.fn("EventLog.lockedCandidate")(function* (consumer: string) {
    yield* UnitOfWork.required;
    const config = yield* registration(consumer);
    if (!(yield* store.lock(consumer))) return undefined;
    return yield* store.candidate(consumer, config.kinds);
  });
  const matching = Effect.fn("EventLog.matching")(function* (token: DeliveryToken) {
    yield* Schema.decodeEffect(DeliveryToken)(token).pipe(Effect.mapError(invalid));
    const candidate = yield* lockedCandidate(token.consumer);
    return candidate !== undefined &&
      candidate.event.id === token.eventId &&
      candidate.attempts === token.attempt &&
      candidate.replay === token.replay &&
      candidate.generation === token.generation
      ? candidate
      : undefined;
  });
  return {
    record: Effect.fn("EventLog.record")(function* (
      actor: Actor | null,
      fact: EventFact,
      requestId: string | null = null,
    ) {
      yield* UnitOfWork.required;
      const decoded = yield* Schema.decodeEffect(EventFact)(fact).pipe(Effect.mapError(invalid));
      const payload = yield* decodePayload(decoded);
      const schema = options.registry[decoded.kind];
      if (schema === undefined) return yield* invalid();
      const encoded = yield* Schema.encodeUnknownEffect(schema)(payload).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(Schema.Json)),
        Effect.mapError(invalid),
      );
      const stored = yield* store.append({
        ...decoded,
        payload: encoded,
        actorId: actor?.id ?? null,
        occurredAt: yield* now,
        requestId,
      });
      return { ...stored, payload };
    }),
    read: Effect.fn("EventLog.read")(function* (query: EventQuery = {}) {
      const decoded = yield* Schema.decodeEffect(EventQuery)(query).pipe(Effect.mapError(invalid));
      const events = yield* store.read(decoded);
      return yield* Effect.forEach(events, (event) =>
        decodePayload(event).pipe(
          Effect.map((payload) => ({ ...event, payload })),
          Effect.mapError((cause) => new EventStoreUnavailable({ cause })),
        ),
      );
    }),
    due: Effect.fn("EventLog.due")(function* () {
      const at = yield* now;
      const due: Array<{ consumer: string }> = [];
      for (const consumer of options.consumers) {
        const next = yield* store.candidate(consumer.name, consumer.kinds);
        if (next !== undefined && next.nextDue <= at) due.push({ consumer: consumer.name });
      }
      return due;
    }),
    claimDue: Effect.fn("EventLog.claimDue")(function* (query: ClaimQuery = {}) {
      yield* UnitOfWork.required;
      yield* Schema.decodeEffect(ClaimQuery)(query).pipe(Effect.mapError(invalid));
      if (query.consumer !== undefined) yield* registration(query.consumer);
      const tokens: Array<DeliveryToken> = [];
      const at = yield* now;
      for (const consumer of options.consumers) {
        if (query.consumer !== undefined && consumer.name !== query.consumer) continue;
        if (tokens.length >= (query.limit ?? 100)) break;
        const candidate = yield* lockedCandidate(consumer.name);
        if (candidate === undefined || candidate.nextDue > at) continue;
        if (candidate.attempts >= consumer.maxAttempts) {
          yield* store.deadLetter({
            consumer: consumer.name,
            eventId: candidate.event.id,
            lastError: candidate.lastError,
            attempts: candidate.attempts,
            failedAt: at,
          });
          yield* store.advance(consumer.name, candidate.event.id, candidate.replay);
          continue;
        }
        const attempt = candidate.attempts + 1;
        const delay = Math.min(
          consumer.backoff.baseMs * 2 ** (attempt - 1),
          consumer.backoff.capMs,
        );
        yield* store.retry(consumer.name, { ...candidate, attempts: attempt, nextDue: at + delay });
        tokens.push({
          consumer: consumer.name,
          eventId: candidate.event.id,
          attempt,
          replay: candidate.replay,
          generation: candidate.generation,
        });
      }
      return tokens;
    }),
    takeNext: Effect.fn("EventLog.takeNext")(function* (token: DeliveryToken) {
      const candidate = yield* matching(token);
      if (candidate === undefined) return null;
      return {
        event: { ...candidate.event, payload: yield* decodePayload(candidate.event) },
        token,
      };
    }),
    settleSuccess: Effect.fn("EventLog.settleSuccess")(function* (token: DeliveryToken) {
      const candidate = yield* matching(token);
      if (candidate === undefined) return false;
      yield* store.advance(token.consumer, token.eventId, token.replay);
      if (token.replay) yield* store.clearDeadLetter(token.consumer, token.eventId);
      return true;
    }),
    settleFailure: Effect.fn("EventLog.settleFailure")(function* (
      token: DeliveryToken,
      lastError: string,
    ) {
      const candidate = yield* matching(token);
      if (candidate === undefined) return false;
      yield* store.retry(token.consumer, { ...candidate, lastError });
      return true;
    }),
    listDeadLetters: Effect.fn("EventLog.listDeadLetters")(function* (query: DeadLetterQuery = {}) {
      const decoded = yield* Schema.decodeEffect(DeadLetterQuery)(query).pipe(
        Effect.mapError(invalid),
      );
      return yield* store.listDeadLetters(decoded);
    }),
    replay: Effect.fn("EventLog.replay")(function* (consumer: string, eventId: string) {
      yield* UnitOfWork.required;
      const config = yield* registration(consumer);
      yield* Schema.decodeEffect(EventId)(eventId).pipe(Effect.mapError(invalid));
      if (!(yield* store.lock(consumer))) return "busy" satisfies ReplayResult;
      const dead = yield* store.findDeadLetter(consumer, eventId);
      if (dead === undefined) return yield* new DeadLetterNotFound();
      const [event] = yield* store.read({
        ...(BigInt(eventId) > 1n ? { after: (BigInt(eventId) - 1n).toString() } : {}),
        limit: 1,
      });
      if (event === undefined || event.id !== eventId || !config.kinds.includes(event.kind))
        return yield* invalid();
      const generation = yield* Effect.all(
        Array.from({ length: 4 }, () => Random.nextIntBetween(0, 0xffff_ffff)),
      ).pipe(
        Effect.map((words) => words.map((word) => word.toString(16).padStart(8, "0")).join("")),
      );
      const enqueued = yield* store.enqueueReplay(consumer, {
        event,
        attempts: 0,
        nextDue: 0,
        replay: true,
        generation,
        lastError: "Delivery failed. See internal logs.",
      });
      return (enqueued ? "enqueued" : "already_queued") satisfies ReplayResult;
    }),
    wakeups: () => Effect.succeed(store.wakeups),
  };
};
export type EventLogService = ReturnType<typeof makeEventLog>;
