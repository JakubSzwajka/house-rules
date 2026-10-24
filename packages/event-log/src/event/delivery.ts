import { Schema } from "effect";
import { EventId, StoredEvent } from "./event.js";

export const DeliveryToken = Schema.Struct({
  consumer: Schema.NonEmptyString,
  eventId: EventId,
  attempt: Schema.Int.check(Schema.isGreaterThan(0)),
  replay: Schema.Boolean,
  generation: Schema.String,
});
export type DeliveryToken = typeof DeliveryToken.Type;
export const ReplayResult = Schema.Literals(["enqueued", "busy", "already_queued"]);
export type ReplayResult = typeof ReplayResult.Type;
export const Delivery = Schema.Struct({ token: DeliveryToken, event: StoredEvent });
export type Delivery = typeof Delivery.Type;
export const DeadLetter = Schema.Struct({
  consumer: Schema.NonEmptyString,
  eventId: EventId,
  lastError: Schema.String,
  attempts: Schema.Int.check(Schema.isGreaterThan(0)),
  failedAt: Schema.Int,
});
export type DeadLetter = typeof DeadLetter.Type;
export const DeadLetterCursor = Schema.Struct({
  eventId: EventId,
  consumer: Schema.NonEmptyString,
});
export type DeadLetterCursor = typeof DeadLetterCursor.Type;
export const DeadLetterQuery = Schema.Struct({
  consumer: Schema.optionalKey(Schema.NonEmptyString),
  after: Schema.optionalKey(DeadLetterCursor),
  limit: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1000 }))),
});
export type DeadLetterQuery = typeof DeadLetterQuery.Type;
export const Candidate = Schema.Struct({
  event: StoredEvent,
  attempts: Schema.Int,
  nextDue: Schema.Int,
  replay: Schema.Boolean,
  generation: Schema.String,
  lastError: Schema.String,
});
export type Candidate = typeof Candidate.Type;
export const ConsumerOptions = Schema.Struct({
  name: Schema.NonEmptyString,
  kinds: Schema.Array(Schema.NonEmptyString).check(Schema.isMinLength(1)),
  maxAttempts: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 }))),
  backoff: Schema.optionalKey(
    Schema.Struct({
      baseMs: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 300000 })),
      capMs: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 300000 })),
    }),
  ),
});
export type ConsumerOptions = typeof ConsumerOptions.Type;
