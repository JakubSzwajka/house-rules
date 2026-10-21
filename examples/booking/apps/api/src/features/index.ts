import { makeBooking } from "./make-booking/index.ts";
import { partnerBooking } from "./book-for-partner/index.ts";
import { cancelBooking } from "./cancel-booking/index.ts";
import { showBooking } from "./show-booking/index.ts";
import { myBookings } from "./my-bookings/index.ts";
import { firstSignIn } from "./first-sign-in/index.ts";
import { nightlyCleanup } from "./nightly-cleanup/index.ts";
export const Features = {
  makeBooking: makeBooking,
  partnerBooking: partnerBooking,
  cancelBooking: cancelBooking,
  showBooking: showBooking,
  myBookings: myBookings,
  firstSignIn: firstSignIn,
  nightlyCleanup: nightlyCleanup,
} as const;
export const memberPermissions = [
  "bookings:read",
  "bookings:write",
  "bookings:cancel",
  "billing:charge",
] as const;
export const partnerPermissions = ["bookings:write"] as const;
export const agentPermissions = ["bookings:read"] as const;
export const systemPermissions = [
  "billing:refund",
  "billing:expire",
  "party:create",
  "identity:bind",
] as const;
