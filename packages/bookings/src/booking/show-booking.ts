import { defineContract } from "@house-rules/application/contract";
import { Schema } from "effect";
import { BookingNotFound, PublicBooking } from "./booking.js";
import { BookingPermissions } from "./permissions.js";
import { BookingStoreUnavailable } from "./store-unavailable.js";

export const showBookingContract = defineContract("show_booking", {
  description: "Show one booking by its id: the guest name and whether it is active or cancelled.",
  input: Schema.Struct({ id: Schema.String }),
  output: PublicBooking,
  failure: Schema.Union([BookingNotFound, BookingStoreUnavailable]),
  permission: BookingPermissions.read,
  annotations: { readOnly: true },
});
