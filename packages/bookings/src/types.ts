import { Schema } from "effect";

export const Booking = Schema.Struct({
  id: Schema.String,
  guestName: Schema.String,
});

export type Booking = typeof Booking.Type;

export class BookingNotFound extends Schema.TaggedError<BookingNotFound>()("BookingNotFound", {
  id: Schema.String,
}) {}

export class BookingAlreadyExists extends Schema.TaggedError<BookingAlreadyExists>()(
  "BookingAlreadyExists",
  { id: Schema.String },
) {}
