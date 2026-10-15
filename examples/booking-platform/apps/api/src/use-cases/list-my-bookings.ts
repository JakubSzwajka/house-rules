import { Bookings, listMyBookingsContract } from "@example/bookings";
import { CurrentActor, implement } from "@house-rules/application";
import { Effect } from "effect";

export const listMyBookings = implement(listMyBookingsContract, () =>
  Effect.gen(function* listMyBookingsHandler() {
    const bookings = yield* Bookings;
    const mine = yield* bookings.listMine(yield* CurrentActor);
    // The public view: never the ownerId.
    return {
      items: mine.map(({ id, guestName, status }) => ({ id, guestName, status })),
    };
  }),
);
