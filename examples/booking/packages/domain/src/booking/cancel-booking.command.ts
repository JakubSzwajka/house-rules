import * as Domain from "@alchemy.run/domain";
import { ActedFor, Forbidden, PartyId, Session } from "@house-rules/stack";
import * as Schema from "effect/Schema";
import { BookingId } from "./booking.id.ts";

export class BookingCancelled extends Domain.Event("BookingCancelled", {
  by: Schema.String,
  for: ActedFor,
  owner: PartyId,
  reason: Schema.NullOr(Schema.String),
}) {}

export class NoSuchBooking extends Domain.Rejection("NoSuchBooking", {}, { httpApiStatus: 404 }) {}

export class NotBookingOwner extends Domain.Rejection(
  "NotBookingOwner",
  {},
  { httpApiStatus: 403 },
) {}

export class CancelBooking extends Domain.Command("CancelBooking", {
  target: BookingId,
  middleware: [Session],
  input: { reason: Schema.optionalKey(Schema.NonEmptyString) },
  events: [BookingCancelled],
  rejects: [Forbidden, NoSuchBooking, NotBookingOwner],
}) {}
