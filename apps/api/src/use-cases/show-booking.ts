import { Bookings, showBookingContract } from "@hosti/bookings";
import { implement } from "@house-rules/application";
import { Effect } from "effect";

export const showBooking = implement(showBookingContract, ({ id }) =>
  Effect.gen(function* showBookingHandler() {
    const bookings = yield* Bookings;
    const booking = yield* bookings.get(id);
    return { id: booking.id, guestName: booking.guestName };
  }),
);
