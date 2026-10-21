import { errorKind } from "@house-rules/domain/contract";
import { Schema } from "effect";

export const BookingStatus = Schema.Literals(["active", "cancelled"]);
export type BookingStatus = typeof BookingStatus.Type;
export const NewBooking = Schema.Struct({
  id: Schema.NonEmptyString,
  guestName: Schema.NonEmptyString,
});
export type NewBooking = typeof NewBooking.Type;
export const Booking = Schema.Struct({
  ...NewBooking.fields,
  ownerId: Schema.String,
  status: BookingStatus,
});
export type Booking = typeof Booking.Type;

export class BookingNotFound extends Schema.TaggedError<BookingNotFound>()("BookingNotFound", {
  kind: errorKind("not_found"),
  id: Schema.String,
}) {
  override get message() {
    return "No such booking.";
  }
}
export class BookingAlreadyExists extends Schema.TaggedError<BookingAlreadyExists>()(
  "BookingAlreadyExists",
  {
    kind: errorKind("conflict"),
    id: Schema.String,
  },
) {
  override get message() {
    return "Booking exists.";
  }
}
export class BookingCallerDenied extends Schema.TaggedError<BookingCallerDenied>()(
  "BookingCallerDenied",
  {
    kind: errorKind("forbidden"),
  },
) {
  override get message() {
    return "Person required.";
  }
}
export class BookingStoreUnavailable extends Schema.TaggedError<BookingStoreUnavailable>()(
  "BookingStoreUnavailable",
  {
    kind: errorKind("unavailable"),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message() {
    return "Bookings unavailable.";
  }
}
