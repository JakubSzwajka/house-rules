import { makeBookingEntry } from "../features/make-booking/entry.ts";
import { partnerBookingEntry } from "../features/book-for-partner/entry.ts";
import { cancelBookingEntry } from "../features/cancel-booking/entry.ts";
import { showBookingEntry } from "../features/show-booking/entry.ts";
import { myBookingsEntry } from "../features/my-bookings/entry.ts";
import { firstSignInEntry } from "../features/first-sign-in/entry.ts";
import { nightlyCleanupEntry } from "../features/nightly-cleanup/entry.ts";
export const Entries = {
  makeBooking: makeBookingEntry,
  partnerBooking: partnerBookingEntry,
  cancelBooking: cancelBookingEntry,
  showBooking: showBookingEntry,
  myBookings: myBookingsEntry,
  firstSignIn: firstSignInEntry,
  nightlyCleanup: nightlyCleanupEntry,
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
