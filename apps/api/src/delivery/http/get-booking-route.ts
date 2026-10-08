import { BookingPermissions, type Bookings } from "@hosti/bookings";
import { Grant } from "@house-rules/capability";
import { Effect, type Layer } from "effect";
import { showBooking } from "../../use-cases/show-booking.js";

export type BookingResponse = Readonly<{
  status: 200 | 403 | 404 | 503;
  body: string;
}>;

export const visitorGrant: Layer.Layer<Grant> = Grant.layerFromPermissions([
  BookingPermissions.read,
]);

export const bookingResponse = (
  id: string,
): Effect.Effect<BookingResponse, never, Bookings | Grant> =>
  showBooking.handler({ id }).pipe(
    Effect.map(
      (booking): BookingResponse => ({ status: 200, body: `${booking.guestName} (${booking.id})` }),
    ),
    Effect.catchTags({
      BookingNotFound: (error) =>
        Effect.succeed<BookingResponse>({
          status: 404,
          body: `Booking ${error.id} was not found.`,
        }),
      BookingStoreUnavailable: () =>
        Effect.succeed<BookingResponse>({
          status: 503,
          body: "Bookings are unavailable right now.",
        }),
      Forbidden: () =>
        Effect.succeed<BookingResponse>({ status: 403, body: "You may not read bookings." }),
    }),
  );

export const getBookingRoute = (id: string): Effect.Effect<BookingResponse, never, Bookings> =>
  bookingResponse(id).pipe(Effect.provide(visitorGrant));
