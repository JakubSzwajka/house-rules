import { Bookings, showBookingContract } from "@hosti/bookings";
import { implement } from "@house-rules/capability";
import { Effect } from "effect";

export const showBooking = implement(showBookingContract, ({ id }) =>
  Effect.gen(function* showBookingHandler() {
    const bookings = yield* Bookings;
    return yield* bookings.get(id);
  }),
);
