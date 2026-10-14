import { Bookings, cancelBookingContract } from "@hosti/bookings";
import { CurrentActor, implement } from "@house-rules/application";
import { Effect } from "effect";

export const cancelBooking = implement(cancelBookingContract, ({ id }) =>
  Effect.gen(function* cancelBookingHandler() {
    const bookings = yield* Bookings;
    const actor = yield* CurrentActor;
    const booking = yield* bookings.cancel(actor, id);
    return { id: booking.id, guestName: booking.guestName, status: booking.status };
  }),
);
