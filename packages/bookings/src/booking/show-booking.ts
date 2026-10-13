import { defineContract } from "@house-rules/capability/contract";
import { Schema } from "effect";
import { BookingNotFound, NewBooking } from "./booking.js";
import { BookingPermissions } from "./permissions.js";
import { BookingStoreUnavailable } from "./store-unavailable.js";

export const showBookingContract = defineContract("show_booking", {
  description: "Show one booking by its id.",
  input: Schema.Struct({ id: Schema.String }),
  output: NewBooking,
  failure: Schema.Union([BookingNotFound, BookingStoreUnavailable]),
  permission: BookingPermissions.read,
  annotations: { readOnly: true },
});
