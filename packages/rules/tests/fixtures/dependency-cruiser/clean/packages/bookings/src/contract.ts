import { Effect } from "effect";
import { findBooking } from "./booking/find-booking";

export const showBookingContract = { name: "show_booking", run: findBooking, effect: Effect };
