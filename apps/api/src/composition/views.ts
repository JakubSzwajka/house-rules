import type { BookingNotFound, BookingStoreUnavailable } from "@hosti/bookings";
import { problemView } from "@house-rules/capability";

export const bookingViews = {
  BookingNotFound: problemView(
    404,
    "not_found",
    (error: BookingNotFound) => `Booking ${error.id} was not found.`,
    { exposeCode: true },
  ),
  BookingStoreUnavailable: problemView(
    503,
    "unavailable",
    (_error: BookingStoreUnavailable) => "Bookings are unavailable right now.",
  ),
};
