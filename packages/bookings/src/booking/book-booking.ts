import { defineContract } from "@house-rules/application/contract";
import { Schema } from "effect";
import { BookingAlreadyExists, NewBooking, PublicBooking } from "./booking.js";
import { BookingPermissions } from "./permissions.js";
import { BookingStoreUnavailable } from "./store-unavailable.js";

export const bookBookingContract = defineContract("book_booking", {
  description: "Book a stay under a new id for the signed-in user, who then owns the booking.",
  input: NewBooking,
  output: PublicBooking,
  failure: Schema.Union([BookingAlreadyExists, BookingStoreUnavailable]),
  permission: BookingPermissions.write,
  transactional: true,
  audit: { target: "id" },
});
