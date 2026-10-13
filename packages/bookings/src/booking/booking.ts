import { Schema } from "effect";

export const NewBooking = Schema.Struct({
  id: Schema.String,
  guestName: Schema.String,
});

export type NewBooking = typeof NewBooking.Type;

export const Booking = Schema.Struct({
  ...NewBooking.fields,
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
