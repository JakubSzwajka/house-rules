import type { BookingNotFound, BookingStoreUnavailable } from "@hosti/bookings";
import { composition, problem, type View } from "@house-rules/capability";
import { Context, Effect } from "effect";
import { appLayer } from "./app-layer.js";

export const bookingViews = {
  BookingNotFound: (error: BookingNotFound): View =>
    problem(404, "not_found", `Booking ${error.id} was not found.`),
  BookingStoreUnavailable: (_error: BookingStoreUnavailable): View =>
    problem(503, "unavailable", "Bookings are unavailable right now."),
};

const visitorCaller = () => {
  // The example has no sign-in, so every visitor holds the root's Grant and the caller adds nothing.
  return Effect.succeed(Context.empty());
};

export const app = composition({ layer: appLayer, caller: visitorCaller, views: bookingViews });
