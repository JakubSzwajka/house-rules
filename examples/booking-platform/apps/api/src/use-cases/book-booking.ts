import { bookBookingContract, Bookings } from "@example/bookings";
import { CurrentActor, implement } from "@house-rules/application";
import { Effect } from "effect";

export const bookBooking = implement(bookBookingContract, (input) =>
  Effect.gen(function* bookBookingHandler() {
    const bookings = yield* Bookings;
    const actor = yield* CurrentActor;
    const booking = yield* bookings.create(actor, input);
    return { id: booking.id, guestName: booking.guestName, status: booking.status };
  }),
);
