import type { BookingNotFound, BookingStoreUnavailable } from "@hosti/bookings";
import { composition, problemView } from "@house-rules/capability";
import { Context, Effect } from "effect";
import { appLayer } from "./app-layer.js";

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

const visitorCaller = () => {
  // The example has no sign-in, so every visitor holds the root's Grant and the caller adds nothing.
  return Effect.succeed(Context.empty());
};

export const app = composition({ layer: appLayer, caller: visitorCaller, views: bookingViews });
