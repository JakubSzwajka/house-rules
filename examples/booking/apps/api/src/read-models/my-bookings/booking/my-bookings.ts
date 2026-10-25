import { errorKind } from "@house-rules/domain/contract";
import { Schema } from "effect";

export const MyBooking = Schema.Struct({
  id: Schema.String,
  guestName: Schema.String,
  ownerId: Schema.String,
  organisationId: Schema.NullOr(Schema.String),
  status: Schema.String,
  paymentStatus: Schema.NullOr(Schema.String),
  amount: Schema.NullOr(Schema.Finite),
});
export type MyBooking = typeof MyBooking.Type;
export class ReadUnavailable extends Schema.TaggedError<ReadUnavailable>()("ReadUnavailable", {
  kind: errorKind("unavailable"),
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message() {
    return "Booking reads unavailable.";
  }
}
export class ReadCallerDenied extends Schema.TaggedError<ReadCallerDenied>()("ReadCallerDenied", {
  kind: errorKind("forbidden"),
}) {
  override get message() {
    return "Person required.";
  }
}
