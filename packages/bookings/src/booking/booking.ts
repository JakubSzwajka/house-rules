import { Schema } from "effect";

export const NewBooking = Schema.Struct({
  id: Schema.String,
  guestName: Schema.String,
});

export type NewBooking = typeof NewBooking.Type;

export const BookingStatus = Schema.Literals(["active", "cancelled"]);

export type BookingStatus = typeof BookingStatus.Type;

export const PublicBooking = Schema.Struct({
  ...NewBooking.fields,
  status: BookingStatus,
});

export type PublicBooking = typeof PublicBooking.Type;

export const Booking = Schema.Struct({
  ...PublicBooking.fields,
  ownerId: Schema.NullOr(Schema.String),
});

export type Booking = typeof Booking.Type;

export class BookingNotFound extends Schema.TaggedError<BookingNotFound>()("BookingNotFound", {
  id: Schema.String,
}) {}

export class BookingAlreadyExists extends Schema.TaggedError<BookingAlreadyExists>()(
  "BookingAlreadyExists",
  { id: Schema.String },
) {}

export class BookingAlreadyCancelled extends Schema.TaggedError<BookingAlreadyCancelled>()(
  "BookingAlreadyCancelled",
  { id: Schema.String },
) {}
