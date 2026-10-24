import { errorKind } from "@house-rules/domain/contract";
import { Schema } from "effect";

export const EventId = Schema.String.check(
  Schema.isPattern(/^[1-9][0-9]*$/),
  Schema.isMaxLength(19),
  Schema.makeFilter((id) => id.length < 19 || id <= "9223372036854775807"),
);
export const EventFact = Schema.Struct({
  kind: Schema.NonEmptyString,
  subject: Schema.Struct({ kind: Schema.NonEmptyString, id: Schema.NonEmptyString }),
  payload: Schema.Unknown,
  scopeId: Schema.NullOr(Schema.NonEmptyString),
});
export type EventFact = typeof EventFact.Type;
export const StoredEvent = Schema.Struct({
  ...EventFact.fields,
  id: EventId,
  actorId: Schema.NullOr(Schema.NonEmptyString),
  occurredAt: Schema.Int,
  requestId: Schema.NullOr(Schema.String),
});
export type StoredEvent = typeof StoredEvent.Type;
export const EventQuery = Schema.Struct({
  after: Schema.optionalKey(EventId),
  kinds: Schema.optionalKey(Schema.Array(Schema.NonEmptyString)),
  subject: Schema.optionalKey(EventFact.fields.subject),
  scopeId: Schema.optionalKey(Schema.NonEmptyString),
  requestId: Schema.optionalKey(Schema.String),
  from: Schema.optionalKey(Schema.Int),
  to: Schema.optionalKey(Schema.Int),
  limit: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1000 }))),
});
export type EventQuery = typeof EventQuery.Type;
export class EventInputInvalid extends Schema.TaggedError<EventInputInvalid>()(
  "EventInputInvalid",
  {
    kind: errorKind("invalid"),
    message: Schema.String,
  },
) {}
export class EventStoreUnavailable extends Schema.TaggedError<EventStoreUnavailable>()(
  "EventStoreUnavailable",
  {
    kind: errorKind("unavailable"),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return "Event log is unavailable. Try again shortly.";
  }
}
export class DeadLetterNotFound extends Schema.TaggedError<DeadLetterNotFound>()(
  "DeadLetterNotFound",
  {
    kind: errorKind("not_found"),
  },
) {
  override get message(): string {
    return "Dead letter not found.";
  }
}
