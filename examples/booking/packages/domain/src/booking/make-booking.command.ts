import * as Domain from "@alchemy.run/domain";
import { Forbidden, PersonId, Session } from "@house-rules/stack";
import * as Schema from "effect/Schema";
import { BookingId } from "./booking.id.ts";

export const Amount = Schema.Int.check(Schema.isGreaterThan(0));

export class BookingMade extends Domain.Event("BookingMade", {
  by: Schema.String,
  owner: PersonId,
  orgId: Schema.NullOr(Schema.String),
  guestName: Schema.String,
  amount: Amount,
}) {}

export class BookingExists extends Domain.Rejection("BookingExists", {}, { httpApiStatus: 409 }) {}

export class NotOrgMember extends Domain.Rejection(
  "NotOrgMember",
  { orgId: Schema.String },
  { httpApiStatus: 403 },
) {}

export class MakeBooking extends Domain.Command("MakeBooking", {
  target: BookingId,
  middleware: [Session],
  input: {
    guestName: Schema.NonEmptyString,
    amount: Amount,
    orgId: Schema.optionalKey(Schema.NonEmptyString),
  },
  events: [BookingMade],
  rejects: [Forbidden, BookingExists, NotOrgMember],
}) {}
