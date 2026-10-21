import { makeBooking } from "./make-booking/index.ts";
import { partnerBooking } from "./book-for-partner/index.ts";
import { cancelBooking } from "./cancel-booking/index.ts";
import { showBooking } from "./show-booking/index.ts";
import { myBookings } from "./my-bookings/index.ts";
import { firstSignIn } from "./first-sign-in/index.ts";
import { nightlyCleanup } from "./nightly-cleanup/index.ts";
import { defineRole } from "./define-role/index.ts";
import { listRoles } from "./list-roles/index.ts";
import { assignRole } from "./assign-role/index.ts";
import { revokeRole } from "./revoke-role/index.ts";
export const Features = {
  makeBooking: makeBooking,
  partnerBooking: partnerBooking,
  cancelBooking: cancelBooking,
  showBooking: showBooking,
  myBookings: myBookings,
  firstSignIn: firstSignIn,
  nightlyCleanup: nightlyCleanup,
  defineRole: defineRole,
  listRoles: listRoles,
  assignRole: assignRole,
  revokeRole: revokeRole,
} as const;
