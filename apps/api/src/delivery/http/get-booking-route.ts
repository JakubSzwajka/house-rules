import type { Bookings } from "@hosti/bookings";
import { Effect } from "effect";
import { showBooking } from "../../use-cases/show-booking.js";

export type BookingResponse = Readonly<{
  status: 200 | 404;
  body: string;
}>;

export const getBookingRoute = (id: string): Effect.Effect<BookingResponse, never, Bookings> =>
  showBooking.handler({ id }).pipe(
    Effect.map(
      (booking): BookingResponse => ({ status: 200, body: `${booking.guestName} (${booking.id})` }),
    ),
    Effect.catchTag("BookingNotFound", (error) =>
      Effect.succeed<BookingResponse>({ status: 404, body: `Booking ${error.id} was not found.` }),
    ),
  );
