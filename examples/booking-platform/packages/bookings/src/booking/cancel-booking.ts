import { defineContract } from "@house-rules/application/contract";
import { Schema } from "effect";
import { BookingAlreadyCancelled, BookingNotFound, PublicBooking } from "./booking.js";
import { BookingPermissions } from "./permissions.js";
import { BookingStoreUnavailable } from "./store-unavailable.js";

export const cancelBookingContract = defineContract("cancel_booking", {
  description:
    "Cancel one of your own active bookings. It cannot be undone, so a human approves each call.",
  input: Schema.Struct({ id: Schema.String }),
  output: PublicBooking,
  failure: Schema.Union([BookingNotFound, BookingAlreadyCancelled, BookingStoreUnavailable]),
  permission: BookingPermissions.cancel,
  needsApproval: true,
  transactional: true,
  annotations: { destructive: true },
  audit: { target: "id" },
});
