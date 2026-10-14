import { Bookings, showBookingContract } from "@example/bookings";
import { implement } from "@house-rules/application";
import { Effect } from "effect";

export const showBooking = implement(showBookingContract, ({ id }) =>
  Effect.gen(function* showBookingHandler() {
    const bookings = yield* Bookings;
    const booking = yield* bookings.get(id);
    // The public view: never the ownerId.
    return { id: booking.id, guestName: booking.guestName, status: booking.status };
  }),
);
