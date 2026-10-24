import { Schema } from "effect";

export const EventEnvelope = Schema.Struct({
  id: Schema.NonEmptyString,
  kind: Schema.NonEmptyString,
  subject: Schema.Struct({ kind: Schema.NonEmptyString, id: Schema.NonEmptyString }),
  payload: Schema.Unknown,
  scopeId: Schema.NullOr(Schema.NonEmptyString),
  actorId: Schema.NullOr(Schema.NonEmptyString),
  occurredAt: Schema.Int,
  requestId: Schema.NullOr(Schema.String),
});
export type EventEnvelope = typeof EventEnvelope.Type;
export const EventInput = Schema.Struct({
  event: EventEnvelope,
  causedBy: Schema.NullOr(Schema.NonEmptyString),
});
export type EventInput = typeof EventInput.Type;
