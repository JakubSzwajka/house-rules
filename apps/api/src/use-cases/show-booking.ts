import { Booking, BookingNotFound, Bookings } from "@hosti/bookings";
import { defineContract, implement } from "@house-rules/capability";
import { Effect, Schema } from "effect";

export const showBookingContract = defineContract("show_booking", {
  description: "Show one booking by its id.",
  input: Schema.Struct({ id: Schema.String }),
  output: Booking,
  failure: BookingNotFound,
  annotations: { readOnly: true },
});

export const showBooking = implement(showBookingContract, ({ id }) =>
  Effect.gen(function* showBookingHandler() {
    const bookings = yield* Bookings;
    return yield* bookings.get(id);
  }),
);
